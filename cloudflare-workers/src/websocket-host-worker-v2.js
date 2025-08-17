// Main Worker - Routes requests and manages authentication
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // WebSocket upgrade requests go directly to Durable Object
    if (url.pathname === '/websocket') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      
      // Get or create the Durable Object instance
      const durableObjectId = env.WEBSOCKET_HANDLER.idFromName('global');
      const durableObject = env.WEBSOCKET_HANDLER.get(durableObjectId);
      
      // Forward the WebSocket request to the Durable Object
      return durableObject.fetch(request);
    }
    
    // Handle broadcast requests from Email Worker
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return handleBroadcast(request, env);
    }
    
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

async function handleBroadcast(request, env) {
  // Verify authorization
  const authHeader = request.headers.get('Authorization');
  const expectedKey = env.INTERNAL_API_KEY;
  if (!expectedKey) {
    console.error('INTERNAL_API_KEY not configured');
    return new Response('Server configuration error', { status: 500 });
  }
  
  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = await request.json();
    
    // Store in KV for persistence (optional backup)
    const dataKey = `2fa_${Date.now()}_${crypto.randomUUID()}`;
    await env.KV_STORE.put(dataKey, JSON.stringify(payload), {
      expirationTtl: 300 // 5 minutes
    });
    
    // Forward to Durable Object for broadcasting
    const durableObjectId = env.WEBSOCKET_HANDLER.idFromName('global');
    const durableObject = env.WEBSOCKET_HANDLER.get(durableObjectId);
    
    const response = await durableObject.fetch(
      new Request('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    );
    
    const result = await response.json();
    
    // If no connections, store for later delivery
    if (result.connectionCount === 0) {
      await env.KV_STORE.put('pending_2fa', JSON.stringify(payload), {
        expirationTtl: 300
      });
    }
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Broadcast error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Durable Object class - Manages all WebSocket connections
export class WebSocketHandler {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map to store active WebSocket connections
    this.connections = new Map();
    
    // Initialize state from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get('connections');
      if (stored) {
        // Note: We can't restore actual WebSocket objects from storage
        // This is just for tracking metadata
        console.log('Loaded connection metadata from storage');
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade
    if (url.pathname === '/websocket') {
      return this.handleWebSocketUpgrade(request);
    }
    
    // Handle internal broadcast requests
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request);
    }
    
    // Get connection status
    if (url.pathname === '/status') {
      return new Response(JSON.stringify({
        activeConnections: this.connections.size,
        connectionIds: Array.from(this.connections.keys())
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }
  
  async handleWebSocketUpgrade(request) {
    // Create WebSocket pair
    // @ts-ignore - WebSocketPair exists in Cloudflare Workers runtime
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    // Accept the WebSocket connection
    server.accept();
    
    // Generate unique connection ID
    const connectionId = crypto.randomUUID();
    const connection = {
      id: connectionId,
      websocket: server,
      authenticated: false,
      extensionId: null,
      connectedAt: new Date().toISOString(),
      lastPing: Date.now()
    };
    
    // Store connection
    this.connections.set(connectionId, connection);
    console.log(`New WebSocket connection: ${connectionId}`);
    
    // Set up authentication timeout
    const authTimeout = setTimeout(() => {
      if (!connection.authenticated) {
        console.log(`Authentication timeout for ${connectionId}`);
        server.send(JSON.stringify({
          type: 'AUTH_REQUIRED',
          message: 'Authentication timeout'
        }));
        server.close(1008, 'Authentication timeout');
        this.connections.delete(connectionId);
      }
    }, 10000); // 10 seconds to authenticate
    
    // Handle incoming messages
    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'AUTH':
            const isValid = await this.authenticateConnection(data, connection);
            if (isValid) {
              clearTimeout(authTimeout);
              connection.authenticated = true;
              connection.extensionId = data.extensionId;
              
              server.send(JSON.stringify({
                type: 'AUTH_SUCCESS',
                connectionId: connectionId
              }));
              
              // Check for pending 2FA data
              const pending = await this.env.KV_STORE.get('pending_2fa', { type: 'json' });
              if (pending) {
                console.log(`Sending pending 2FA data to ${connectionId}`);
                server.send(JSON.stringify(pending));
                await this.env.KV_STORE.delete('pending_2fa');
              }
            } else {
              server.send(JSON.stringify({
                type: 'AUTH_FAILED',
                message: 'Invalid authentication'
              }));
              server.close(1008, 'Authentication failed');
              this.connections.delete(connectionId);
            }
            break;
            
          case 'PING':
            connection.lastPing = Date.now();
            server.send(JSON.stringify({ type: 'PONG' }));
            break;
            
          case 'PONG':
            connection.lastPing = Date.now();
            break;
            
          default:
            console.log(`Unknown message type from ${connectionId}: ${data.type}`);
        }
      } catch (error) {
        console.error(`Error handling message from ${connectionId}:`, error);
      }
    });
    
    // Handle connection close
    server.addEventListener('close', () => {
      console.log(`WebSocket closed: ${connectionId}`);
      clearTimeout(authTimeout);
      this.connections.delete(connectionId);
    });
    
    // Handle errors
    server.addEventListener('error', (error) => {
      console.error(`WebSocket error for ${connectionId}:`, error);
      clearTimeout(authTimeout);
      this.connections.delete(connectionId);
    });
    
    // Set up ping interval
    const pingInterval = setInterval(() => {
      if (this.connections.has(connectionId)) {
        const conn = this.connections.get(connectionId);
        if (Date.now() - conn.lastPing > 60000) {
          console.log(`Ping timeout for ${connectionId}`);
          server.close(1001, 'Ping timeout');
          this.connections.delete(connectionId);
          clearInterval(pingInterval);
        } else if (conn.authenticated) {
          server.send(JSON.stringify({ type: 'PING' }));
        }
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
    
    // Return the client side of the WebSocket pair
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  async authenticateConnection(data, connection) {
    // Simple token validation
    if (!data.token) return false;
    
    const expectedToken = this.env.AUTH_TOKEN;
    if (!expectedToken) {
      console.warn('AUTH_TOKEN not configured, using timestamp-based validation only');
    }
    
    // Check if it's an extension-specific token
    if (data.token.startsWith('ext-')) {
      const [, extensionId, timestamp] = data.token.split('-');
      
      // Validate timestamp (not too old)
      const tokenTime = parseInt(timestamp, 10);
      if (isNaN(tokenTime) || Math.abs(Date.now() - tokenTime) > 300000) {
        return false;
      }
      
      return true;
    }
    
    return data.token === expectedToken;
  }
  
  async handleBroadcast(request) {
    try {
      const payload = await request.json();
      
      // Count authenticated connections
      let broadcastCount = 0;
      const failedConnections = [];
      
      // Broadcast to all authenticated connections
      for (const [id, connection] of this.connections) {
        if (connection.authenticated && connection.websocket) {
          try {
            connection.websocket.send(JSON.stringify({
              type: '2FA_SEQUENCE',
              ...payload
            }));
            broadcastCount++;
            console.log(`Broadcasted to ${id}`);
          } catch (error) {
            console.error(`Failed to send to ${id}:`, error);
            failedConnections.push(id);
          }
        }
      }
      
      // Clean up failed connections
      failedConnections.forEach(id => this.connections.delete(id));
      
      return new Response(JSON.stringify({
        success: true,
        connectionCount: broadcastCount,
        totalConnections: this.connections.size
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Broadcast error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
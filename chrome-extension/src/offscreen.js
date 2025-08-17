class WebSocketManager {
  constructor() {
    this.websocket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.isIntentionalClose = false;
    this.config = null;
    this.heartbeatInterval = null;
    this.lastHeartbeat = Date.now();
  }

  async init() {
    await this.loadConfig();
    await this.connect();
  }

  async loadConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
        this.config = response;
        resolve();
      });
    });
  }

  async connect() {
    try {
      const websocketUrl = this.config?.websocketUrl || 'wss://your-websocket-worker.workers.dev/websocket';
      
      if (websocketUrl === 'wss://your-websocket-worker.workers.dev/websocket') {
        console.warn('⚠️ Using default WebSocket URL. Please configure your actual Worker URL.');
      }
      
      console.log('Connecting to WebSocket:', websocketUrl);
      this.websocket = new WebSocket(websocketUrl);
      
      this.setupEventHandlers();
      
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.websocket.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      
      chrome.runtime.sendMessage({
        type: 'WEBSOCKET_STATUS',
        status: 'connected'
      });

      this.authenticate();
      this.startHeartbeat();
    };

    this.websocket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      
      chrome.runtime.sendMessage({
        type: 'WEBSOCKET_STATUS',
        status: 'error'
      });
    };

    this.websocket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      
      this.stopHeartbeat();
      
      chrome.runtime.sendMessage({
        type: 'WEBSOCKET_STATUS',
        status: 'closed'
      });

      if (!this.isIntentionalClose) {
        this.scheduleReconnect();
      }
    };
  }

  async authenticate() {
    const extensionId = chrome.runtime.id;
    const timestamp = Date.now();
    const token = await this.generateAuthToken(extensionId, timestamp);

    this.send({
      type: 'AUTH',
      token: token,
      extensionId: extensionId,
      timestamp: timestamp
    });
  }

  async generateAuthToken(extensionId, timestamp) {
    try {
      const storedToken = await chrome.storage.local.get(['authToken']);
      if (storedToken.authToken) {
        return storedToken.authToken;
      }
    } catch (error) {
      console.log('Storage not available in offscreen context, generating new token');
    }
    
    return `ext-${extensionId}-${timestamp}-${Math.random().toString(36).substring(2, 18)}`;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.websocket?.readyState === WebSocket.OPEN) {
        this.send({ type: 'PING' });
        this.lastHeartbeat = Date.now();
        
        setTimeout(() => {
          if (Date.now() - this.lastHeartbeat > 35000) {
            console.warn('Heartbeat timeout, reconnecting...');
            this.websocket.close();
          }
        }, 35000);
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('Received message:', message);

      switch (message.type) {
        case 'AUTH_SUCCESS':
          console.log('Authentication successful');
          this.handleAuthSuccess(message);
          break;
          
        case 'AUTH_FAILED':
          console.error('Authentication failed:', message.message);
          this.isIntentionalClose = true;
          this.websocket.close();
          break;
          
        case 'PING':
          this.send({ type: 'PONG' });
          break;
          
        case 'PONG':
          this.lastHeartbeat = Date.now();
          break;
          
        case '2FA_SEQUENCE':
          this.handle2FASequence(message);
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
      
    } catch (error) {
      console.error('Failed to parse message:', error, data);
    }
  }

  handleAuthSuccess(message) {
    try {
      chrome.storage.local.set({
        connectionId: message.connectionId,
        connectedAt: new Date().toISOString()
      });
    } catch (error) {
      console.log('Storage not available in offscreen context:', error);
    }
  }

  handle2FASequence(message) {
    console.log('Received 2FA sequence:', message);
    
    chrome.runtime.sendMessage({
      type: 'WEBSOCKET_DATA',
      data: {
        sequence: message.sequence,
        sessionId: message.sessionId,
        timestamp: message.timestamp,
        metadata: message.emailMetadata
      }
    });

    this.showNotification(message.sequence);
  }

  showNotification(sequence) {
    if (!chrome.notifications) {
      return;
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon128.png'),
      title: 'Rakuten Securities 2FA',
      message: `Received authentication code: ${sequence.join(', ')}`,
      priority: 2
    });
  }

  send(data) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not open, cannot send message');
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      chrome.runtime.sendMessage({
        type: 'WEBSOCKET_STATUS',
        status: 'failed'
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    this.isIntentionalClose = true;
    this.stopHeartbeat();
    
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }
}

const manager = new WebSocketManager();
manager.init();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'KEEP_ALIVE') {
    sendResponse({ status: 'alive' });
  } else if (message.type === 'CONNECT_WEBSOCKET') {
    console.log('Received CONNECT_WEBSOCKET message');
    manager.connect();
    sendResponse({ status: 'connecting' });
  } else if (message.type === 'DISCONNECT_WEBSOCKET') {
    console.log('Received DISCONNECT_WEBSOCKET message');
    manager.disconnect();
    sendResponse({ status: 'disconnected' });
  }
});

window.addEventListener('unload', () => {
  manager.disconnect();
});
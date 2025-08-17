export class WebSocketSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.webSocket = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/websocket/')) {
      if (this.webSocket) {
        return new Response('WebSocket session already active', { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      this.webSocket = server;

      server.accept();
      server.addEventListener('close', () => { this.webSocket = null; });
      server.addEventListener('error', () => { this.webSocket = null; });

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/forward') {
      if (request.headers.get('Authorization') !== `Bearer ${this.env.INTERNAL_API_KEY}`) {
        return new Response('Unauthorized', { status: 401 });
      }

      const data = await request.json();
      if (this.webSocket) {
        this.webSocket.send(JSON.stringify(data));
        return new Response('Message forwarded', { status: 200 });
      } else {
        return new Response('No active WebSocket session', { status: 404 });
      }
    }

    return new Response('Not found', { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/websocket/')) {
      const userId = path.split('/')[2];
      if (!userId) {
        return new Response('User ID is required', { status: 400 });
      }
      const id = env.WEBSOCKET_SESSIONS.idFromName(userId);
      const stub = env.WEBSOCKET_SESSIONS.get(id);
      return stub.fetch(request);
    }

    if (path === '/broadcast') { // This endpoint is now more specific
        const payload = await request.json();
        const userId = payload.userId;
        if (!userId) {
            return new Response('userId is required in payload', { status: 400 });
        }

        const id = env.WEBSOCKET_SESSIONS.idFromName(userId);
        const stub = env.WEBSOCKET_SESSIONS.get(id);

        // Forward the request to the Durable Object's /forward endpoint
        const forwardRequest = new Request(new URL('/forward', request.url), {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(payload)
        });

        return stub.fetch(forwardRequest);
    }

    return new Response('Not found', { status: 404 });
  },
};
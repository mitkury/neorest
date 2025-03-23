/**
 * Simplified standalone Deno server example with multi-strategy support
 * No external dependencies - all code in one file
 */

// ===== Type definitions =====
type ConnectionSecret = string;

interface MsgWrapper {
  id: string;
  type: string;
  route?: string;
  verb?: string;
  data?: any;
  headers?: Record<string, string>;
}

interface ServerStrategy {
  isConnected(): boolean;
  send(message: MsgWrapper): void;
  onMessage(callback: (message: MsgWrapper) => void): void;
  onClose(callback: () => void): void;
  disconnect(): void;
}

// ===== HTTP Strategy =====
class HttpStrategy implements ServerStrategy {
  private clientId: string;
  private messageQueue: MsgWrapper[] = [];
  private lastPollTime: number = Date.now();
  private active: boolean = true;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private timeoutId: number | null = null;
  private timeoutDuration = 30000; // 30 seconds timeout for inactive connections
  
  constructor(clientId: string) {
    this.clientId = clientId;
    this.startInactivityTimer();
    console.log(`HTTP strategy created for client ${clientId}`);
  }

  private startInactivityTimer(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    
    this.timeoutId = setTimeout(() => {
      if (Date.now() - this.lastPollTime > this.timeoutDuration) {
        console.log(`HTTP client ${this.clientId} inactive, disconnecting`);
        this.disconnect();
      } else {
        this.startInactivityTimer();
      }
    }, this.timeoutDuration) as unknown as number;
  }

  isConnected(): boolean {
    return this.active;
  }

  send(message: MsgWrapper): void {
    if (this.active) {
      console.log(`Queuing message for HTTP client ${this.clientId}`);
      this.messageQueue.push({ ...message }); // Clone to avoid reference issues
    }
  }

  getQueuedMessages(): MsgWrapper[] {
    this.lastPollTime = Date.now();
    this.startInactivityTimer();
    
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  processMessage(message: MsgWrapper): void {
    this.lastPollTime = Date.now();
    this.startInactivityTimer();
    
    if (this.messageCallback) {
      this.messageCallback(message);
    }
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  disconnect(): void {
    this.active = false;
    this.messageQueue = [];
    
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    if (this.closeCallback) {
      this.closeCallback();
    }
  }
}

// ===== WebSocket Strategy =====
class WebSocketStrategy implements ServerStrategy {
  private socket: WebSocket;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.socket.onclose = () => {
      if (this.closeCallback) {
        this.closeCallback();
      }
    };

    this.socket.onmessage = (event) => {
      if (this.messageCallback) {
        try {
          const message = JSON.parse(event.data as string) as MsgWrapper;
          this.messageCallback(message);
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.socket.close();
    };
  }

  isConnected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: MsgWrapper): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending message:', error);
        this.disconnect();
      }
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  disconnect(): void {
    try {
      this.socket.close();
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
  }
}

// ===== Server Connection =====
class ServerConnection {
  private strategy: ServerStrategy;
  private connectionId: string;
  private routes: Set<string> = new Set();

  constructor(strategy: ServerStrategy, connectionId: string = crypto.randomUUID()) {
    this.strategy = strategy;
    this.connectionId = connectionId;
    
    this.setupListeners();
  }

  private setupListeners(): void {
    this.strategy.onMessage((message) => {
      this.handleMessage(message);
    });

    this.strategy.onClose(() => {
      console.log(`Connection ${this.connectionId} closed`);
    });
  }

  private handleMessage(message: MsgWrapper): void {
    console.log(`Message received from ${this.connectionId}:`, message.type);
    
    // Handle different message types
    switch (message.type) {
      case 'route_request':
        this.handleRouteRequest(message);
        break;
      case 'subscribe':
        this.handleSubscription(message);
        break;
      case 'unsubscribe':
        this.handleUnsubscription(message);
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleRouteRequest(message: MsgWrapper): void {
    if (!message.route || !message.verb) {
      this.sendError(message.id, 'Missing route or verb');
      return;
    }

    const route = message.route;
    const verb = message.verb;
    const data = message.data;

    // Find route handler and execute it
    try {
      // This would normally check registered routes and call the handler
      // For simplicity, we'll just echo back a response
      const responseData = {
        route,
        verb,
        requestData: data,
        message: `Processed ${verb} request to ${route}`,
        timestamp: new Date().toISOString()
      };

      this.sendResponse(message.id, responseData);
    } catch (error) {
      this.sendError(message.id, `Error processing route: ${error}`);
    }
  }

  private handleSubscription(message: MsgWrapper): void {
    if (!message.route) {
      this.sendError(message.id, 'Missing route in subscription request');
      return;
    }

    const route = message.route;
    
    // Add route to subscriptions
    this.routes.add(route);
    console.log(`Client ${this.connectionId} subscribed to ${route}`);
    
    // Confirm subscription
    this.sendResponse(message.id, { 
      success: true, 
      message: `Subscribed to ${route}` 
    });
  }

  private handleUnsubscription(message: MsgWrapper): void {
    if (!message.route) {
      this.sendError(message.id, 'Missing route in unsubscription request');
      return;
    }

    const route = message.route;
    
    // Remove route from subscriptions
    this.routes.delete(route);
    console.log(`Client ${this.connectionId} unsubscribed from ${route}`);
    
    // Confirm unsubscription
    this.sendResponse(message.id, { 
      success: true, 
      message: `Unsubscribed from ${route}` 
    });
  }

  public sendResponse(requestId: string, data: any): void {
    this.strategy.send({
      id: requestId,
      type: 'response',
      data
    });
  }

  public sendError(requestId: string, error: string): void {
    this.strategy.send({
      id: requestId,
      type: 'error',
      data: { error }
    });
  }

  public sendBroadcast(route: string, action: string, data: any): void {
    if (this.isSubscribedToRoute(route)) {
      this.strategy.send({
        id: crypto.randomUUID(),
        type: 'broadcast',
        route,
        data: {
          action,
          data
        }
      });
    }
  }

  public isSubscribedToRoute(route: string): boolean {
    return this.routes.has(route);
  }

  public getSubscribedRoutes(): string[] {
    return Array.from(this.routes);
  }

  public getConnectionId(): string {
    return this.connectionId;
  }

  public close(): void {
    this.strategy.disconnect();
  }
}

// ===== Router =====
class Router {
  private connections: Map<string, ServerConnection> = new Map();
  private httpConnections: Map<string, HttpStrategy> = new Map();
  private server: Deno.Server | null = null;
  private port: number;
  private hostname: string;
  private sessionCleanupInterval: number | null = null;

  constructor(options: { port?: number; hostname?: string } = {}) {
    this.port = options.port || 8080;
    this.hostname = options.hostname || 'localhost';
    
    // Set up periodic cleanup of inactive HTTP connections
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupInactiveHttpConnections();
    }, 60000) as unknown as number;
  }
  
  private cleanupInactiveHttpConnections(): void {
    const inactiveIds: string[] = [];
    
    for (const [id, strategy] of this.httpConnections.entries()) {
      if (!strategy.isConnected()) {
        inactiveIds.push(id);
      }
    }
    
    for (const id of inactiveIds) {
      this.httpConnections.delete(id);
      console.log(`Cleaned up inactive HTTP connection: ${id}`);
    }
  }

  public async listen(): Promise<void> {
    // Create a controller for handling cleanup
    const controller = new AbortController();
    const { signal } = controller;

    // Set up a handler for HTTP requests
    const handler = async (request: Request): Promise<Response> => {
      // Check if it's a WebSocket upgrade request
      if (request.headers.get("upgrade") === "websocket") {
        try {
          // Create WebSocket connection
          const { socket, response } = Deno.upgradeWebSocket(request);
          
          // Handle WebSocket connection
          this.handleWebSocketConnection(socket, request);
          
          return response;
        } catch (error) {
          console.error("WebSocket upgrade error:", error);
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
      }
      
      // Handle HTTP request (either regular HTTP or long-polling)
      return this.handleHttpRequest(request);
    };

    // Create the server
    this.server = Deno.serve({ 
      port: this.port, 
      hostname: this.hostname, 
      signal 
    }, handler);
    
    console.log(`Server listening on http://${this.hostname}:${this.port}`);
  }

  private handleWebSocketConnection(socket: WebSocket, request: Request): void {
    const connectionId = crypto.randomUUID();
    console.log(`New WebSocket connection: ${connectionId}`);
    
    // Create strategy and connection
    const strategy = new WebSocketStrategy(socket);
    const connection = new ServerConnection(strategy, connectionId);
    
    // Add connection to map
    this.connections.set(connectionId, connection);
    
    // Set up cleanup
    socket.onclose = () => {
      this.connections.delete(connectionId);
      console.log(`WebSocket connection ${connectionId} removed`);
    };
  }
  
  /**
   * Handle an HTTP request
   * @param request - The HTTP request
   * @returns The HTTP response
   */
  private async handleHttpRequest(request: Request): Promise<Response> {
    console.log(`HTTP ${request.method} request: ${request.url}`);
    
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    const isPoll = url.searchParams.get('poll') === 'true';
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Client-ID',
        }
      });
    }
    
    // If no client ID, generate one and send it back
    if (!clientId) {
      const newClientId = crypto.randomUUID();
      return new Response(JSON.stringify({ clientId: newClientId }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Create or retrieve HTTP strategy for this client
    let strategy = this.httpConnections.get(clientId);
    
    if (!strategy) {
      console.log(`New HTTP client connection: ${clientId}`);
      strategy = new HttpStrategy(clientId);
      this.httpConnections.set(clientId, strategy);
      
      // Create connection with this strategy
      const connection = new ServerConnection(strategy, clientId);
      this.connections.set(clientId, connection);
    }
    
    // Handle long polling - return any queued messages
    if (isPoll) {
      const messages = strategy.getQueuedMessages();
      if (messages.length > 0) {
        return new Response(JSON.stringify(messages), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else {
        // No messages, return 204 No Content
        return new Response(null, { 
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
    }
    
    // Handle regular HTTP requests (POST for messages)
    if (request.method === 'POST') {
      try {
        // Parse the message and process it
        const message = await request.json() as MsgWrapper;
        strategy.processMessage(message);
        
        // Wait briefly for a response - give the handlers time to process
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Return any immediate response messages
        const responseMessages = strategy.getQueuedMessages();
        if (responseMessages.length > 0) {
          return new Response(JSON.stringify(responseMessages[0]), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        } else {
          // No immediate response
          return new Response(null, { 
            status: 202, // Accepted
            headers: { 'Access-Control-Allow-Origin': '*' }
          });
        }
      } catch (error) {
        console.error('Error processing HTTP message:', error);
        return new Response(JSON.stringify({ error: 'Invalid message format' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // Default response for other request types
    return new Response('Neorest server', { 
      status: 200,
      headers: { 
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*' 
      }
    });
  }

  public broadcastPost(route: string, data: any, excludedConnectionId?: string): void {
    for (const [id, connection] of this.connections.entries()) {
      if (excludedConnectionId && id === excludedConnectionId) {
        continue;
      }
      
      if (connection.isSubscribedToRoute(route)) {
        connection.sendBroadcast(route, 'post', data);
      }
    }
  }

  public broadcastDeletion(route: string, data: any, excludedConnectionId?: string): void {
    for (const [id, connection] of this.connections.entries()) {
      if (excludedConnectionId && id === excludedConnectionId) {
        continue;
      }
      
      if (connection.isSubscribedToRoute(route)) {
        connection.sendBroadcast(route, 'delete', data);
      }
    }
  }

  public async close(): Promise<void> {
    // Stop the HTTP session cleanup interval
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
    
    // Close all HTTP strategy connections
    for (const strategy of this.httpConnections.values()) {
      strategy.disconnect();
    }
    this.httpConnections.clear();
    
    // Close all regular connections
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    
    // Shut down the server
    if (this.server) {
      this.server.shutdown();
      this.server = null;
    }
    
    console.log('Server stopped');
  }
}

// ===== Demo server =====
const router = new Router({ port: 8080 });

// Start the server
console.log('Starting Neorest server...');
await router.listen();
console.log('Server is running');

// Every 10 seconds, broadcast a message to all connections subscribed to /time
setInterval(() => {
  const time = new Date().toISOString();
  console.log(`Broadcasting time update: ${time}`);
  router.broadcastPost('/time', { time });
}, 10000);

// Keep the server running
await new Promise(() => {});
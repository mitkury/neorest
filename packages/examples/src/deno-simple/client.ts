/**
 * Simplified standalone Deno client example
 * No external dependencies - all code in one file
 */

// ===== Type definitions =====
interface MsgWrapper {
  id: string;
  type: string;
  route?: string;
  verb?: string;
  data?: any;
  headers?: Record<string, string>;
}

interface RouteResponse<T = any> {
  route: string;
  status: number;
  data: T;
  headers?: Record<string, string>;
}

interface BroadcastEvent<T = any> {
  route: string;
  action: string;
  data: T;
  timestamp: string;
}

// ===== WebSocket Strategy =====
class WebSocketStrategy {
  private socket: WebSocket | null = null;
  private url: string;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private connected = false;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    try {
      this.socket = new WebSocket(this.url);
      
      // Set up event handlers
      this.setupSocketHandlers();
      
      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error("WebSocket not initialized"));
          return;
        }
        
        const onOpenHandler = () => {
          this.connected = true;
          resolve();
          // Clean up handler
          if (this.socket) this.socket.removeEventListener('open', onOpenHandler);
        };
        
        const onErrorHandler = (event: Event) => {
          reject(new Error("WebSocket connection failed"));
          // Clean up handler
          if (this.socket) this.socket.removeEventListener('error', onErrorHandler);
        };
        
        this.socket.addEventListener('open', onOpenHandler);
        this.socket.addEventListener('error', onErrorHandler);
      });
      
    } catch (error) {
      console.error("Error connecting:", error);
      throw error;
    }
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;
    
    // Message handler
    this.socket.onmessage = (event) => {
      if (this.messageCallback) {
        try {
          const data = JSON.parse(event.data as string) as MsgWrapper;
          this.messageCallback(data);
        } catch (error) {
          console.error("Error parsing message:", error);
        }
      }
    };
    
    // Close handler
    this.socket.onclose = () => {
      this.connected = false;
      if (this.closeCallback) {
        this.closeCallback();
      }
    };
    
    // Error handler
    this.socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(message: MsgWrapper): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error("Error sending message:", error);
      this.disconnect();
    }
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        console.error("Error closing WebSocket:", error);
      }
      this.socket = null;
    }
    
    this.connected = false;
  }
}

// ===== Client Connection =====
class ClientConnection {
  private strategy: WebSocketStrategy;
  private pendingRequests: Map<string, (response: any) => void> = new Map();
  private subscriptions: Map<string, (event: BroadcastEvent) => void> = new Map();

  constructor(strategy: WebSocketStrategy) {
    this.strategy = strategy;
  }

  async connect(): Promise<void> {
    await this.strategy.connect();
    this.setupListeners();
  }

  private setupListeners(): void {
    this.strategy.onMessage((message) => {
      this.handleMessage(message);
    });

    this.strategy.onClose(() => {
      console.log("Connection closed");
    });
  }

  private handleMessage(message: MsgWrapper): void {
    switch (message.type) {
      case 'response':
        this.handleResponse(message);
        break;
      case 'error':
        this.handleError(message);
        break;
      case 'broadcast':
        this.handleBroadcast(message);
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleResponse(message: MsgWrapper): void {
    const requestId = message.id;
    const callback = this.pendingRequests.get(requestId);
    
    if (callback) {
      callback({
        status: 200,
        data: message.data,
        route: message.route || '',
        headers: message.headers
      });
      
      this.pendingRequests.delete(requestId);
    }
  }

  private handleError(message: MsgWrapper): void {
    const requestId = message.id;
    const callback = this.pendingRequests.get(requestId);
    
    if (callback) {
      callback({
        status: 500,
        data: message.data,
        route: message.route || '',
        headers: message.headers
      });
      
      this.pendingRequests.delete(requestId);
    }
  }

  private handleBroadcast(message: MsgWrapper): void {
    if (!message.route) return;
    
    const route = message.route;
    const callback = this.subscriptions.get(route);
    
    if (callback && message.data) {
      const broadcastEvent: BroadcastEvent = {
        route,
        action: message.data.action,
        data: message.data.data,
        timestamp: new Date().toISOString()
      };
      
      callback(broadcastEvent);
    }
  }

  sendToRoute<T = any>(
    route: string,
    verb: string,
    payload: any,
    headers: Record<string, string> = {},
    callback: (response: RouteResponse<T>) => void
  ): void {
    const requestId = crypto.randomUUID();
    
    // Register callback for response
    this.pendingRequests.set(requestId, callback);
    
    // Send request
    this.strategy.send({
      id: requestId,
      type: 'route_request',
      route,
      verb,
      data: payload,
      headers
    });
  }

  async subscribeToRoute<T = any>(
    route: string,
    callback: (event: BroadcastEvent<T>) => void
  ): Promise<void> {
    // Register subscription callback
    this.subscriptions.set(route, callback as any);
    
    // Send subscription request
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      
      this.pendingRequests.set(requestId, (response) => {
        if (response.status === 200) {
          resolve();
        } else {
          this.subscriptions.delete(route);
          reject(new Error(`Failed to subscribe to ${route}: ${response.data?.error || 'Unknown error'}`));
        }
      });
      
      this.strategy.send({
        id: requestId,
        type: 'subscribe',
        route
      });
    });
  }

  unsubscribeFromRoute(route: string): void {
    this.subscriptions.delete(route);
    
    this.strategy.send({
      id: crypto.randomUUID(),
      type: 'unsubscribe',
      route
    });
  }

  isConnected(): boolean {
    return this.strategy.isConnected();
  }

  close(): void {
    this.strategy.disconnect();
  }
}

// ===== Client =====
class Client {
  private conn: ClientConnection;
  
  constructor(url: string) {
    const strategy = new WebSocketStrategy(url);
    this.conn = new ClientConnection(strategy);
  }
  
  async connect(): Promise<void> {
    await this.conn.connect();
  }
  
  isConnected(): boolean {
    return this.conn.isConnected();
  }
  
  close(): void {
    this.conn.close();
  }
  
  get<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return new Promise((resolve) => {
      this.conn.sendToRoute<T>(route, "GET", "", headers || {}, (response) => {
        resolve(response);
      });
    });
  }
  
  post<T = any>(route: string, payload?: any, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return new Promise((resolve) => {
      this.conn.sendToRoute<T>(route, "POST", payload, headers || {}, (response) => {
        resolve(response);
      });
    });
  }
  
  delete<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return new Promise((resolve) => {
      this.conn.sendToRoute<T>(route, "DELETE", "", headers || {}, (response) => {
        resolve(response);
      });
    });
  }
  
  on<T = any>(route: string, callback: (event: BroadcastEvent<T>) => void): Promise<void> {
    return this.conn.subscribeToRoute<T>(route, callback);
  }
  
  off(route: string): void {
    this.conn.unsubscribeFromRoute(route);
  }
}

// ===== Demo client =====
async function main() {
  try {
    // Create client
    const client = new Client('ws://localhost:8080');
    
    // Connect
    console.log('Connecting to server...');
    await client.connect();
    console.log('Connected to server');
    
    // Subscribe to time updates
    console.log('Subscribing to /time...');
    await client.on('/time', (event) => {
      console.log(`Received time update: ${event.data.time}`);
    });
    console.log('Subscribed to /time');
    
    // Send a GET request
    console.log('Sending GET request to /status...');
    const response = await client.get('/status');
    console.log('Response:', response.data);
    
    // Send a POST request
    console.log('Sending POST request to /messages...');
    const postResponse = await client.post('/messages', { text: 'Hello, server!' });
    console.log('Post response:', postResponse.data);
    
    // Wait for 30 seconds to receive time broadcasts
    console.log('Waiting for broadcasts (30 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Unsubscribe and close
    console.log('Unsubscribing from /time...');
    client.off('/time');
    
    console.log('Closing connection...');
    client.close();
    console.log('Connection closed');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the client
main();
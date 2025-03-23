/**
 * Simplified standalone Deno HTTP client example
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

// ===== HTTP Strategy =====
class HttpStrategy {
  private url: string;
  private clientId: string | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private connected = false;
  private pollInterval: number | null = null;
  private pollDelay = 1000; // 1 second

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    try {
      // Get a client ID from the server
      const response = await fetch(this.url);
      const data = await response.json();
      this.clientId = data.clientId;
      
      if (!this.clientId) {
        throw new Error('Failed to get client ID from server');
      }
      
      console.log(`Got client ID: ${this.clientId}`);
      this.connected = true;
      
      // Start polling for messages
      this.startPolling();
      
      return Promise.resolve();
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  private async startPolling(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    
    // Poll the server for messages
    this.pollInterval = setInterval(async () => {
      if (!this.connected) {
        return;
      }
      
      try {
        // Add client ID to URL
        const pollUrl = new URL(this.url);
        pollUrl.searchParams.set('clientId', this.clientId!);
        pollUrl.searchParams.set('poll', 'true');
        
        const response = await fetch(pollUrl.toString());
        
        if (response.status === 204) {
          // No content, keep polling
          return;
        }
        
        if (!response.ok) {
          console.error(`HTTP error: ${response.status}`);
          return;
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const messages = await response.json() as MsgWrapper[];
          
          // Process all messages
          if (Array.isArray(messages)) {
            for (const message of messages) {
              if (this.messageCallback) {
                this.messageCallback(message);
              }
            }
          } else if (messages && this.messageCallback) {
            // Single message
            this.messageCallback(messages);
          }
        }
      } catch (error) {
        console.error('Error polling for messages:', error);
      }
    }, this.pollDelay) as unknown as number;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(message: MsgWrapper): Promise<void> {
    if (!this.connected || !this.clientId) {
      throw new Error('Not connected');
    }
    
    try {
      // Add client ID to URL
      const sendUrl = new URL(this.url);
      sendUrl.searchParams.set('clientId', this.clientId);
      
      const response = await fetch(sendUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
      
      if (!response.ok && response.status !== 202) {
        // 202 Accepted is OK (no content but accepted)
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      // Check for immediate response
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const responseData = await response.json() as MsgWrapper;
        if (responseData && this.messageCallback) {
          this.messageCallback(responseData);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  disconnect(): void {
    this.connected = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    if (this.closeCallback) {
      this.closeCallback();
    }
  }
}

// ===== Client Connection =====
class ClientConnection {
  private strategy: HttpStrategy;
  private pendingRequests: Map<string, (response: any) => void> = new Map();
  private subscriptions: Map<string, (event: BroadcastEvent) => void> = new Map();

  constructor(strategy: HttpStrategy) {
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
      console.log('Connection closed');
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

  async sendToRoute<T = any>(
    route: string,
    verb: string,
    payload: any,
    headers: Record<string, string> = {},
    callback: (response: RouteResponse<T>) => void
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    
    // Register callback for response
    this.pendingRequests.set(requestId, callback);
    
    // Send request
    await this.strategy.send({
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
    return new Promise(async (resolve, reject) => {
      const requestId = crypto.randomUUID();
      
      this.pendingRequests.set(requestId, (response) => {
        if (response.status === 200) {
          resolve();
        } else {
          this.subscriptions.delete(route);
          reject(new Error(`Failed to subscribe to ${route}: ${response.data?.error || 'Unknown error'}`));
        }
      });
      
      try {
        await this.strategy.send({
          id: requestId,
          type: 'subscribe',
          route
        });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        this.subscriptions.delete(route);
        reject(error);
      }
    });
  }

  async unsubscribeFromRoute(route: string): Promise<void> {
    this.subscriptions.delete(route);
    
    await this.strategy.send({
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
    const strategy = new HttpStrategy(url);
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
  
  async get<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return new Promise((resolve) => {
      this.conn.sendToRoute<T>(route, "GET", "", headers || {}, (response) => {
        resolve(response);
      });
    });
  }
  
  async post<T = any>(route: string, payload?: any, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return new Promise((resolve) => {
      this.conn.sendToRoute<T>(route, "POST", payload, headers || {}, (response) => {
        resolve(response);
      });
    });
  }
  
  async delete<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return new Promise((resolve) => {
      this.conn.sendToRoute<T>(route, "DELETE", "", headers || {}, (response) => {
        resolve(response);
      });
    });
  }
  
  async on<T = any>(route: string, callback: (event: BroadcastEvent<T>) => void): Promise<void> {
    return this.conn.subscribeToRoute<T>(route, callback);
  }
  
  async off(route: string): Promise<void> {
    return this.conn.unsubscribeFromRoute(route);
  }
}

// ===== Demo client =====
async function main() {
  try {
    // Create client with HTTP strategy
    const client = new Client('http://localhost:8080');
    
    // Connect
    console.log('Connecting to server...');
    await client.connect();
    console.log('Connected to server');
    
    // Subscribe to time updates
    console.log('Subscribing to /time...');
    await client.on('/time', (event) => {
      console.log(`Received time update via HTTP: ${event.data.time}`);
    });
    console.log('Subscribed to /time');
    
    // Send a GET request
    console.log('Sending GET request to /status...');
    const response = await client.get('/status');
    console.log('Response:', response.data);
    
    // Send a POST request
    console.log('Sending POST request to /messages...');
    const postResponse = await client.post('/messages', { text: 'Hello from HTTP client!' });
    console.log('Post response:', postResponse.data);
    
    // Wait for 30 seconds to receive time broadcasts
    console.log('Waiting for broadcasts (30 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Unsubscribe and close
    console.log('Unsubscribing from /time...');
    await client.off('/time');
    
    console.log('Closing connection...');
    client.close();
    console.log('Connection closed');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the client
main();
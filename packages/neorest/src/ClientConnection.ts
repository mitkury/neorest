import { ConnectionBase } from '@neorest/core';
import { 
  ClientTransport,
  BroadcastEvent,
  ConnectionOptions,
  ReconnectOptions,
  MsgID,
  MsgRoute,
  MsgDataSet,
  ROUTE_MESSAGE,
  ON_ROUTE,
  OFF_ROUTE,
  new_MsgSubscribeToRoute,
  new_MsgUnsubscribeFromRoute,
  new_MsgResponseOK,
  RouteResponse,
  RouteVerb,
  Payload,
  newConnectionSecret,
  msg_ConnDataSet
} from './core';
import { createTransport } from './transports/index';

/**
 * Client-side connection implementation
 */
export class ClientConnection extends ConnectionBase {
  private isFullyConnected = false;
  private subscribedRoutes: Record<string, (broadcast: BroadcastEvent) => void> = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectOptions: ReconnectOptions | undefined;
  private reconnectAttempts = 0;
  private url?: string;
  private defaultRequestHeaders: Record<string, string> = {};
  
  /**
   * Event called when client is connected
   */
  public onClientConnect: () => void = () => {};

  /**
   * Constructor
   * @param transport - The communication transport to use
   * @param options - Options for the connection
   */
  constructor(transport: ClientTransport, options?: ConnectionOptions) {
    super(transport);
    
    // Extract secret from transport URL if available, otherwise generate one
    const connectionInfo = transport.getConnectionInfo();
    const urlObj = new URL(connectionInfo.url);
    const existingSecret = urlObj.searchParams.get('secret');
    
    if (existingSecret) {
      this.setHeader('secret', existingSecret);
    } else {
      // Generate a secret for this connection
      const secret = newConnectionSecret();
      this.setHeader('secret', secret);
    }
    
    this.onClientConnect = () => {};
    
    // Set up reconnect options
    this.reconnectOptions = options?.reconnect === false
      ? undefined
      : {
          maxAttempts: 10,
          initialDelay: 500,
          maxDelay: 30000,
          factor: 1.5,
          ...(typeof options?.reconnect === 'object' ? options.reconnect : {})
        };
    
    // Add route message handler
    this.registerRouteMessageHandler();
    
    // Override onOpen and onClose
    this.setupConnectionHandlers();
  }

  /**
   * Set the URL for the connection
   * @param url - The URL to connect to
   * @param transportType - The type of transport to use
   */
  public async setUrl(url: string, transportType?: 'websocket' | 'http' | 'auto'): Promise<void> {
    this.url = url;
    
    // Close existing connection
    this.close();
    
    // Create new transport
    const type = transportType || this.getTransportType();
    
    // Check if URL already has a secret parameter
    const urlObj = new URL(url);
    const existingSecret = urlObj.searchParams.get('secret');
    
    let connectionUrl = url;
    if (!existingSecret && (type === 'websocket' || (type === 'auto' && url.startsWith('ws')))) {
      // Generate a secret for this connection only if none exists
      const secret = newConnectionSecret();
      urlObj.searchParams.set('secret', secret);
      connectionUrl = urlObj.toString();
      this.setHeader('secret', secret);
    } else if (existingSecret) {
      this.setHeader('secret', existingSecret);
    }
    
    const transport = createTransport(type, connectionUrl);
    
    // Set the new transport
    this.setTransport(transport);
    
    // Connect with new transport
    await this.connect();
  }

  /**
   * Check if the connection is fully established
   * @returns True if connected, false otherwise
   */
  public isConnected(): boolean {
    return this.isFullyConnected;
  }

  /**
   * Get the connection secret
   * @returns The connection secret
   */
  public getSecret(): string {
    return this.getHeader('secret') as string || '';
  }

  /**
   * Get the transport type
   * @returns The transport type
   */
  public getTransportType(): 'websocket' | 'http' | 'auto' {
    const type = (this.transport as any).getConnectionInfo().type;
    if (type === 'websocket' || type === 'http' || type === 'auto') {
      return type;
    }
    
    // Default to auto
    return 'auto';
  }

  /**
   * Send a message to a route
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   * @param callback - Optional callback for the response
   */
  public sendToRoute<T = any>(
    route: string, 
    verb: RouteVerb, 
    payload: Payload, 
    headers?: Record<string, string>, 
    callback?: (response: RouteResponse<T>) => void
  ): void {
    // Validate route
    this.validateRoute(route);
    
    // Check rate limiting
    if (this.messagesSentInASecond > ConnectionBase.SEND_LIMIT_PER_SEC) {
      callback?.({
        error: `Rate limit of ${ConnectionBase.SEND_LIMIT_PER_SEC} messages per second exceeded`,
        data: null as any
      });
      return;
    }

    // Create route message
    const mergedHeaders = { ...this.defaultRequestHeaders, ...(headers || {}) };
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload !== undefined ? payload : "",
      headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined
    };
    
    // Send message and register callback
    const msgId = this.postAndExpectResponse(msg);
    this.messagesSentInASecond++;

    if (callback) {
      this.callbacks.set(msgId, callback);
    }
  }

  /**
   * Send a message to a route without expecting a response
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   */
  public sendToRouteAndForget(route: string, verb: RouteVerb, payload: Payload, headers?: Record<string, string>): void {
    // Validate route
    this.validateRoute(route);
    
    // Create and send message
    const mergedHeaders = { ...this.defaultRequestHeaders, ...(headers || {}) };
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload,
      headers: Object.keys(mergedHeaders).length ? mergedHeaders : undefined
    };
    
    this.postAndForget(msg);
  }

  /**
   * Subscribe to a route
   * @param route - The route to subscribe to
   * @param callback - The callback to call when a message is received on the route
   * @returns A promise that resolves when the subscription is established
   */
  public on<T = any>(
    route: string,
    callback: (broadcast: BroadcastEvent<T>) => void,
  ): Promise<void> {
    return this.connSubscribe(route, callback);
  }

  private connSubscribe<T = any>(
    route: string,
    callback: (broadcast: BroadcastEvent<T>) => void,
  ): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      // Check if already subscribed
      if (this.subscribedRoutes[route]) {
        const errorMsg = `Route "${route}" already has a subscription`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      // Register callback
      this.subscribedRoutes[route] = callback as (broadcast: BroadcastEvent) => void;

      try {
        await this.waitForConnection();
      } catch (e) {
        console.error(`ClientConnection: Timeout waiting for connection to subscribe to ${route}`);
        reject(new Error(`Connection timeout for subscription to ${route}`));
        return;
      }

      // Send subscription message
      this.post(new_MsgSubscribeToRoute(route), (response) => {
        if (response.error) {
          const errorMsg = `Failed to subscribe to route "${route}": ${response.error}`;
          console.error(errorMsg);
          // Remove the subscription if the server rejects it
          delete this.subscribedRoutes[route];
          reject(new Error(errorMsg));
        } else {
          resolve();
        }
      });
    });
  }

  private waitForConnection(timeoutMs = 5000): Promise<void> {
    if (this.isFullyConnected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let resolved = false;
      let checkInterval: ReturnType<typeof setInterval>;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(checkInterval);
          reject(new Error("Connection timeout"));
        }
      }, timeoutMs);

      checkInterval = setInterval(() => {
        if (this.isFullyConnected) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            clearInterval(checkInterval);
            resolve();
          }
        }
      }, 100);
    });
  }

  /**
   * Unsubscribe from a route
   * @param route - The route to unsubscribe from
   */
  public off(route: string): void {
    // Send unsubscription message
    this.post(new_MsgUnsubscribeFromRoute(route), (response) => {
      if (response.error) {
        console.error(`Failed to unsubscribe from route "${route}": ${response.error}`);
        return;
      }
    });

    // Remove route from subscribed routes
    delete this.subscribedRoutes[route];
  }

  /**
   * Validate a route
   * @param route - The route to validate
   * @throws Error if the route is invalid
   */
  private validateRoute(route: string): void {
    if (!/^[a-zA-Z0-9_\/-]+$/.test(route)) {
      // Be explicit about colons, because users may send them by accident.
      // The server uses colons for route parameters.
      if (route.includes(":")) {
        throw new Error(`Route "${route}" contains colons ':' which is not allowed. Colons are reserved for route parameters.`);
      }

      throw new Error(`Route "${route}" contains invalid characters. Only alphanumeric characters, forward slashes, dashes and underscores are allowed.`);
    }
  }

  /**
   * Set up connection handlers
   */
  private setupConnectionHandlers(): void {
    const originalOnOpen = this.onOpen;
    this.onOpen = () => {
      originalOnOpen();
      this.isFullyConnected = true;
      this.reconnectAttempts = 0;
      this.onClientConnect();
    };

    const originalOnClose = this.onClose;
    this.onClose = () => {
      originalOnClose();
      this.isFullyConnected = false;
      this.scheduleReconnect();
    };
  }

  /**
   * Register the route message handler
   */
  private registerRouteMessageHandler(): void {
    this.registerHandler(ROUTE_MESSAGE, (_, msg) => {
      const routeMsg = msg as MsgRoute;
      const sub = this.subscribedRoutes[routeMsg.route];
      
      if (sub) {
        const action = routeMsg.verb as "POST" | "DELETE";
        sub({ data: routeMsg.data, action: action });
      }
      
      return new_MsgResponseOK(_, "ok");
    });

    // DATA_SET messages are no longer used - secret is embedded in connection URL
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // Only reconnect if enabled
    if (this.reconnectOptions) {
      console.error("Connection closed, re-connecting...");
      this.reconnectTimer = setTimeout(() => this.reconnect(), this.reconnectOptions.initialDelay);
    }
  }

  /**
   * Attempt to reconnect
   */
  private async reconnect(): Promise<void> {
    if (!this.url) {
      return;
    }

    try {
      // Create new transport with same URL
      const transportType = this.getTransportType();
      const transport = createTransport(transportType, this.url);
      
      // Secret will be applied when DATA_SET arrives after reconnect
      
      // Set new transport and connect
      this.setTransport(transport);
      await this.connect();
      
      // After reconnection, resubscribe to routes
      this.resubscribeToRoutes();
    } catch (error) {
      console.error("Reconnection failed:", error);
      
      this.reconnectAttempts++;

      // Schedule another reconnection attempt with exponential backoff
      const initialDelay = this.reconnectOptions?.initialDelay || 500;
      const factor = this.reconnectOptions?.factor || 1.5;
      const maxDelay = this.reconnectOptions?.maxDelay || 30000;
      
      const nextDelay = Math.min(
        initialDelay * Math.pow(factor, this.reconnectAttempts),
        maxDelay
      );
      
      this.reconnectTimer = setTimeout(() => this.reconnect(), nextDelay);
    }
  }

  /**
   * Resubscribe to all routes
   */
  private resubscribeToRoutes(): void {
    for (const route in this.subscribedRoutes) {
      this.post(new_MsgSubscribeToRoute(route), (response) => {
        if (response.error) {
          console.error(`Failed to resubscribe to route "${route}"`, response.error);
        }
      });
    }
  }

  public setDefaultHeaders(headers: Record<string, string>): void {
    this.defaultRequestHeaders = { ...headers };
  }
}

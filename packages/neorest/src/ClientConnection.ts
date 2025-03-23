import { 
  ConnectionBase, 
  ClientStrategy, 
  CommunicationStrategy,
  BroadcastEvent,
  ConnectionOptions,
  ReconnectOptions,
  MsgID,
  MsgRoute,
  ROUTE_MESSAGE,
  ON_ROUTE,
  OFF_ROUTE,
  new_MsgSubscribeToRoute,
  new_MsgUnsubscribeFromRoute,
  new_MsgResponseOK,
  RouteResponse,
  RouteVerb,
  Payload,
  newConnectionSecret
} from '@neorest/core';

/**
 * Client-side connection implementation
 */
export class ClientConnection extends ConnectionBase {
  private isFullyConnected = false;
  private subscribedRoutes: Record<string, (broadcast: BroadcastEvent) => void> = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectOptions: ReconnectOptions;
  private url?: string;
  
  /**
   * Event called when client is connected
   */
  public onClientConnect: () => void = () => {};

  /**
   * Constructor
   * @param strategy - The communication strategy to use
   * @param options - Options for the connection
   */
  constructor(strategy: CommunicationStrategy, options?: ConnectionOptions) {
    super(strategy);
    
    // Initialize with default secret
    this.setHeader('secret', newConnectionSecret());
    
    // Set up reconnect options
    this.reconnectOptions = {
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
   * @param strategyType - The type of strategy to use
   */
  public async setUrl(url: string, strategyType?: 'websocket' | 'http'): Promise<void> {
    this.url = url;
    // Implementation will depend on the specific strategies
    // This is a placeholder
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
   * Get the strategy type
   * @returns The strategy type
   */
  public getStrategyType(): 'websocket' | 'http' {
    if (this.strategy instanceof ClientStrategy) {
      return this.strategy.getConnectionInfo().type as 'websocket' | 'http';
    }
    throw new Error("Unknown strategy type");
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
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload !== undefined ? payload : "",
      headers
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
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload,
      headers
    };
    
    this.postAndForget(msg);
  }

  /**
   * Subscribe to a route
   * @param route - The route to subscribe to
   * @param callback - The callback to call when a message is received on the route
   * @returns A promise that resolves when the subscription is established
   */
  public subscribeToRoute<T = any>(route: string, callback: (broadcast: BroadcastEvent<T>) => void): Promise<void> {
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

      // Wait for connection
      while (true) {
        if (this.isFullyConnected) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
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

  /**
   * Unsubscribe from a route
   * @param route - The route to unsubscribe from
   */
  public unsubscribeFromRoute(route: string): void {
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
      // Reconnection logic will be implemented here
      // This depends on the specific strategies
      
      // After reconnection, resubscribe to routes
      this.resubscribeToRoutes();
    } catch (error) {
      console.error("Reconnection failed:", error);
      
      // Schedule another reconnection attempt with exponential backoff
      const nextDelay = Math.min(
        this.reconnectOptions.initialDelay * Math.pow(this.reconnectOptions.factor || 1.5, 1),
        this.reconnectOptions.maxDelay || 30000
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
}
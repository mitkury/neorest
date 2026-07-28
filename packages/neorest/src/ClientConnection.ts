import { ConnectionBase } from './core/ConnectionBase';
import { 
  ClientTransport,
  BroadcastEvent,
  ConnectionOptions,
  ReconnectOptions,
  MsgRoute,
  ROUTE_MESSAGE,
  new_MsgSubscribeToRoute,
  new_MsgUnsubscribeFromRoute,
  new_MsgResponseOK,
  RouteResponse,
  RouteVerb,
  Payload,
  TransportMode,
  newConnectionSecret,
} from './core';
import { createTransport } from './transports/index';

/**
 * Client-side connection implementation
 */
export class ClientConnection extends ConnectionBase {
  private isFullyConnected = false;
  private isClosing = false;
  private isReplacingTransport = false;
  private isReconnecting = false;
  private subscribedRoutes: Record<string, (broadcast: BroadcastEvent) => void> = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectOptions: ReconnectOptions | undefined;
  private reconnectAttempts = 0;
  private url?: string;
  private defaultRequestHeaders: Record<string, string> = {};
  private requestTimeoutMs?: number;
  private connectionChangeListeners = new Set<(connected: boolean) => void>();
  private readonly connectionOptions: ConnectionOptions;
  
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
    this.connectionOptions = options ?? {};
    
    // Extract secret from transport URL if available, otherwise generate one
    const connectionInfo = transport.getConnectionInfo();
    this.url = connectionInfo.url;
    const urlObj = new URL(connectionInfo.url);
    const existingSecret = urlObj.searchParams.get('secret');
    
    if (existingSecret) {
      this.setHeader('secret', existingSecret);
    } else {
      // Generate a secret for this connection
      const secret = newConnectionSecret();
      this.setHeader('secret', secret);
    }
    this.applyConnectionSecret(transport);

    this.defaultRequestHeaders = { ...(options?.headers || {}) };
    this.requestTimeoutMs = options?.timeout;
    if (
      this.requestTimeoutMs !== undefined
      && (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0)
    ) {
      throw new Error('Connection timeout must be a positive number');
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

  public async connect(): Promise<void> {
    this.isClosing = false;
    this.clearReconnectTimer();
    await super.connect();
  }

  public close(): void {
    const wasConnected = this.isFullyConnected;
    this.isClosing = true;
    this.isFullyConnected = false;
    this.clearReconnectTimer();
    super.close();
    if (wasConnected) {
      this.emitConnectionChange(false);
    }
  }

  /**
   * Set the URL for the connection
   * @param url - The URL to connect to
   * @param transportType - The type of transport to use
   */
  public async setUrl(url: string, transportType?: TransportMode): Promise<void> {
    // Create new transport
    const type = transportType || this.getTransportType();
    
    // Check if URL already has a secret parameter
    const urlObj = new URL(url);
    const existingSecret = urlObj.searchParams.get('secret');
    
    let connectionUrl = url;
    if (
      !existingSecret
      && (type === 'websocket' || (type === 'auto' && url.startsWith('ws')))
    ) {
      // Generate a secret for this connection only if none exists
      const secret = newConnectionSecret();
      urlObj.searchParams.set('secret', secret);
      connectionUrl = urlObj.toString();
      this.setHeader('secret', secret);
    } else if (existingSecret) {
      this.setHeader('secret', existingSecret);
    }
    
    const transport = createTransport(type, connectionUrl, this.connectionOptions);
    this.url = connectionUrl;
    this.applyConnectionSecret(transport);
    
    // Set the new transport
    await this.replaceTransport(transport);
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
   * Get the current connection URL.
   */
  public getURL(): string {
    return this.url || (this.transport as ClientTransport).getConnectionInfo().url;
  }

  /**
   * Get the transport type
   * @returns The transport type
   */
  public getTransportType(): TransportMode {
    const clientTransport = this.transport as ClientTransport;
    const mode = clientTransport.getConnectionMode?.();
    if (mode) {
      return mode;
    }
    const type = clientTransport.getConnectionInfo().type;
    if (type === 'websocket' || type === 'webtransport' || type === 'http') {
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
    if (this.messagesSentInASecond >= ConnectionBase.SEND_LIMIT_PER_SEC) {
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
    this.messagesSentInASecond++;
    this.postAndExpectResponse(msg, callback, this.requestTimeoutMs);
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

  private async connSubscribe<T = any>(
    route: string,
    callback: (broadcast: BroadcastEvent<T>) => void,
  ): Promise<void> {
    this.validateRoute(route);
    if (typeof callback !== 'function') {
      throw new TypeError('Subscription callback must be a function');
    }
    if (this.subscribedRoutes[route]) {
      throw new Error(`Route "${route}" already has a subscription`);
    }

    const registeredCallback = callback as (broadcast: BroadcastEvent) => void;
    this.subscribedRoutes[route] = registeredCallback;

    try {
      await this.waitForConnection(this.requestTimeoutMs ?? 5000);
      await new Promise<void>((resolve, reject) => {
        this.post(new_MsgSubscribeToRoute(route), (response) => {
          if (response.error) {
            reject(new Error(`Failed to subscribe to route "${route}": ${response.error}`));
          } else {
            resolve();
          }
        }, this.requestTimeoutMs);
      });
    } catch (error) {
      if (this.subscribedRoutes[route] === registeredCallback) {
        delete this.subscribedRoutes[route];
      }
      if (error instanceof Error && error.message === 'Connection timeout') {
        throw new Error(`Connection timeout for subscription to ${route}`);
      }
      throw error;
    }
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
    this.validateRoute(route);
    // Send unsubscription message
    this.post(new_MsgUnsubscribeFromRoute(route), (response) => {
      if (response.error) {
        console.error(`Failed to unsubscribe from route "${route}": ${response.error}`);
        return;
      }
    }, this.requestTimeoutMs);

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
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      this.onClientConnect();
      if (!this.isReconnecting) {
        this.emitConnectionChange(true);
      }
    };

    const originalOnClose = this.onClose;
    this.onClose = () => {
      originalOnClose();
      if (this.isClosing || this.isReplacingTransport || this.transport.isConnected()) {
        return;
      }

      this.isFullyConnected = false;
      this.emitConnectionChange(false);
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
        const action = routeMsg.verb as "POST" | "DELETE" | "UPDATE";
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
    this.clearReconnectTimer();

    if (!this.reconnectOptions || this.isClosing) {
      return;
    }

    const maxAttempts = this.reconnectOptions.maxAttempts ?? 10;
    if (this.reconnectAttempts >= maxAttempts) {
      return;
    }

    console.error("Connection closed, re-connecting...");
    const delay = this.reconnectOptions.initialDelay ?? 500;
    this.reconnectTimer = setTimeout(() => void this.reconnect(), delay);
  }

  /**
   * Attempt to reconnect
   */
  private async reconnect(): Promise<void> {
    if (!this.url || this.isClosing) {
      return;
    }

    try {
      this.isReconnecting = true;
      // Create new transport with same URL
      const transportType = this.getTransportType();
      const transport = createTransport(
        transportType,
        this.url,
        this.connectionOptions,
      );
      this.applyConnectionSecret(transport);

      await this.replaceTransport(transport);
      
      // After reconnection, resubscribe to routes
      await this.resubscribeToRoutes();
      this.isReconnecting = false;
      this.emitConnectionChange(true);
    } catch (error) {
      this.isReconnecting = false;
      console.error("Reconnection failed:", error);
      
      this.reconnectAttempts++;

      const maxAttempts = this.reconnectOptions?.maxAttempts ?? 10;
      if (this.reconnectAttempts >= maxAttempts) {
        this.clearReconnectTimer();
        return;
      }

      // Schedule another reconnection attempt with exponential backoff
      const initialDelay = this.reconnectOptions?.initialDelay || 500;
      const factor = this.reconnectOptions?.factor || 1.5;
      const maxDelay = this.reconnectOptions?.maxDelay || 30000;
      
      const nextDelay = Math.min(
        initialDelay * Math.pow(factor, this.reconnectAttempts),
        maxDelay
      );
      
      this.reconnectTimer = setTimeout(() => void this.reconnect(), nextDelay);
    }
  }

  /**
   * Resubscribe to all routes
   */
  private async resubscribeToRoutes(): Promise<void> {
    await Promise.all(Object.keys(this.subscribedRoutes).map((route) => {
      return new Promise<void>((resolve) => {
        this.post(new_MsgSubscribeToRoute(route), (response) => {
          if (response.error) {
            console.error(`Failed to resubscribe to route "${route}"`, response.error);
          }
          resolve();
        }, this.requestTimeoutMs ?? 5000);
      });
    }));
  }

  public setDefaultHeaders(headers: Record<string, string>): void {
    this.defaultRequestHeaders = { ...headers };
  }

  public onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionChangeListeners.add(callback);
    return () => {
      this.connectionChangeListeners.delete(callback);
    };
  }

  public setAuthToken(token: string): void {
    this.defaultRequestHeaders = {
      ...this.defaultRequestHeaders,
      Authorization: `Bearer ${token}`,
    };
  }

  public clearAuthToken(): void {
    const { Authorization: _authorization, authorization: _lowerAuthorization, ...headers } =
      this.defaultRequestHeaders;
    this.defaultRequestHeaders = headers;
  }

  private async replaceTransport(transport: ClientTransport): Promise<void> {
    this.isReplacingTransport = true;
    this.clearReconnectTimer();
    try {
      await super.setTransport(transport);
    } finally {
      this.isReplacingTransport = false;
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private applyConnectionSecret(transport: ClientTransport): void {
    const secret = this.getSecret();
    const transportWithSecret = transport as ClientTransport & {
      setConnectionSecret?: (secret: string) => void;
    };
    transportWithSecret.setConnectionSecret?.(secret);
  }

  private emitConnectionChange(connected: boolean): void {
    for (const listener of this.connectionChangeListeners) {
      try {
        listener(connected);
      } catch (error) {
        console.error('Error in connection change listener', error);
      }
    }
  }
}

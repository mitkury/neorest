import type {
  ConnectionSecret,
  MsgID,
  MsgRoute,
  Payload,
  BroadcastEvent,
  RouteResponse,
  RouteVerb,
  RouteSubID,
  InRouteLayer,
  OutRouteLayer,
  RequestContext,
  RouterOptions,
  ServerAdapter,
  ConnectionIdentity,
  SubscriptionAuthorizer,
  SubscriptionAuthorizationResult,
} from './types';
import type { CommunicationTransport } from './CommunicationTransport';
import type { LiveRoomOptions, LiveServerOptions } from './live';

// Re-export types for backward compatibility
export type { RouterOptions, ServerAdapter, RequestContext };
import { newConnectionSecret } from './utils/connectionSecret';
import { ServerConnection } from './ServerConnection';
import { LiveRoomManager } from './LiveRoomManager';
import { LiveServerManager } from './LiveServerManager';
import { 
  Key,
  match,
  MatchResult,
  pathToRegexp,
} from './utils/pathToRegexp';

type SubscriptionAuthorizationLayer = {
  route: string;
  regexp: RegExp;
  match: ReturnType<typeof match>;
  keys: string[];
  specificity: number;
  authorize: SubscriptionAuthorizer;
};

// Types are now imported from './types'

/**
 * Core router implementation that can be used with any server adapter
 */
export class Router {
  /**
   * The next route subscription id
   */
  private nextRouteSubID: RouteSubID = 0;
  
  /**
   * All the active connections that the router has
   */
  protected connections: Record<ConnectionSecret, ServerConnection> = {};

  /**
   * Connections that are being removed but have a grace period for reconnection
   */
  private pendingRemovals: Record<ConnectionSecret, NodeJS.Timeout> = {};
  
  /**
   * Routes that the router uses to handle incoming messages
   */
  private inRoutes: InRouteLayer[] = [];
  
  /**
   * Routes that the router uses to send messages to the clients
   */
  private outRoutes: OutRouteLayer[] = [];

  private subscriptionAuthorizationRoutes: SubscriptionAuthorizationLayer[] = [];

  private readonly liveRooms: LiveRoomManager;

  private readonly liveServers: LiveServerManager;
  
  /**
   * Router options
   */
  protected options: Required<Omit<RouterOptions, 'createLivePeerConnection'>>;

  /**
   * Server adapter for platform-specific implementation
   */
  protected serverAdapter?: ServerAdapter;

  /**
   * Constructor
   * @param options - Router options
   */
  constructor(options?: RouterOptions) {
    this.liveRooms = new LiveRoomManager();
    this.liveServers = new LiveServerManager(options?.createLivePeerConnection);
    this.options = {
      logLevel: options?.logLevel ?? 'info',
      validateRoutes: options?.validateRoutes ?? true,
      maxMessagesPerSecond: options?.maxMessagesPerSecond ?? 100,
      maxConnections: options?.maxConnections ?? 10_000,
      connectionGracePeriodMs: options?.connectionGracePeriodMs ?? 1_000,
    };
    this.validateLimits();

    // Default: allow broadcasts to any route unless overridden
    this.setOutRoute('/:any(.*)', () => true);
  }

  /**
   * Set the server adapter
   * @param adapter - The server adapter
   * @returns This router instance for chaining
   */
  setServerAdapter(adapter: ServerAdapter): this {
    this.serverAdapter = adapter;
    return this;
  }

  /**
   * Start the server
   * @returns A promise that resolves when the server is started
   */
  async listen(): Promise<void> {
    if (!this.serverAdapter) {
      throw new Error('Server adapter not set. Call setServerAdapter before listen.');
    }

    await this.serverAdapter.initialize(this);
    await this.serverAdapter.start();
  }

  /**
   * Start the server.
   * Alias for listen().
   */
  async start(): Promise<void> {
    await this.listen();
  }

  /**
   * Stop the server
   * @returns A promise that resolves when the server is stopped
   */
  async close(): Promise<void> {
    this.liveServers.close();
    this.liveRooms.close();
    if (this.serverAdapter) {
      await this.serverAdapter.stop();
    }
    for (const connection of Object.values(this.connections)) {
      connection.close();
    }
    for (const timer of Object.values(this.pendingRemovals)) {
      clearTimeout(timer);
    }
    this.pendingRemovals = {};
    this.connections = {};
  }

  /**
   * Register a GET handler for a route
   * @param route - The route pattern
   * @param handler - The handler function
   * @returns This router instance for chaining
   */
  onGet(
    route: string,
    handler: (ctx: RequestContext) => void | Promise<void>,
  ): this {
    this.setInRoute(route, "GET", handler);
    return this;
  }

  /**
   * Register a POST handler for a route
   * @param route - The route pattern
   * @param handler - The handler function
   * @returns This router instance for chaining
   */
  onPost(
    route: string,
    handler: (ctx: RequestContext) => void | Promise<void>,
  ): this {
    this.setInRoute(route, "POST", handler);
    return this;
  }

  /**
   * Register a DELETE handler for a route
   * @param route - The route pattern
   * @param handler - The handler function
   * @returns This router instance for chaining
   */
  onDelete(
    route: string,
    handler: (ctx: RequestContext) => void | Promise<void>,
  ): this {
    this.setInRoute(route, "DELETE", handler);
    return this;
  }

  /**
   * Register a client-to-server WebRTC session on a normal Neorest route.
   * The server peer connection is created by `createLivePeerConnection`.
   */
  onLive(route: string, options: LiveServerOptions = {}): this {
    const definition = this.liveServers.register(route, options);
    this.setInRoute(route, 'LIVE', (context) => {
      return this.liveServers.handle(definition, context);
    });
    return this;
  }

  /** Register a relayed one-to-one client peer room. */
  onLiveRoom(route: string, options: LiveRoomOptions = {}): this {
    const definition = this.liveRooms.register(route, options);
    this.setInRoute(route, 'LIVE', (context) => {
      return this.liveRooms.handle(definition, context);
    });
    return this;
  }

  /**
   * Register a validation function for broadcast messages
   * @param route - The route pattern
   * @param validate - The validation function
   * @returns This router instance for chaining
   */
  onValidateBroadcast(
    route: string,
    validate: (
      conn: ServerConnection,
      params: Record<string, string>,
    ) => boolean | Promise<boolean>,
  ): this {
    this.setOutRoute(route, validate);
    return this;
  }

  /**
   * Authorize subscription registration for a route pattern.
   * The most specific matching authorizer is used.
   */
  onAuthorizeSubscription(
    route: string,
    authorize: SubscriptionAuthorizer,
  ): this {
    const keys: Key[] = [];
    const regexp = pathToRegexp(route, keys);
    const keyNames = keys.map((key) => String(key.name));
    const existing = this.subscriptionAuthorizationRoutes.find(
      (layer) => String(layer.regexp) === String(regexp),
    );
    const layer: SubscriptionAuthorizationLayer = {
      route,
      regexp,
      match: match(regexp, { decode: decodeURIComponent }),
      keys: keyNames,
      specificity: this.computeSpecificityScore(route, keyNames),
      authorize,
    };
    if (existing) {
      existing.authorize = authorize;
    } else {
      this.subscriptionAuthorizationRoutes.push(layer);
      this.subscriptionAuthorizationRoutes.sort((a, b) => b.specificity - a.specificity);
    }
    return this;
  }

  /**
   * Send a POST message to a specific connection
   * @param route - The route to send to
   * @param conn - The connection to send to
   * @param payload - The payload to send
   */
  post(route: string, conn: ServerConnection, payload: Payload): void {
    this.connections[conn.getSecret()].sendToRoute(route, "POST", payload);
  }

  /**
   * Broadcast a POST message to all subscribed clients
   * @param route - The route to broadcast to
   * @param payload - The payload to send
   * @param exceptConn - Optional connection to exclude from the broadcast
   */
  broadcastPost(route: string, payload: Payload, exceptConn?: ServerConnection): void {
    this.internalBroadcast(route, "POST", payload, exceptConn);
  }

  /**
   * Broadcast an event to all subscribed clients.
   */
  broadcast(route: string, event: BroadcastEvent, exceptConn?: ServerConnection): void {
    switch (event.action) {
      case "POST":
        this.broadcastPost(route, event.data, exceptConn);
        return;
      case "DELETE":
        this.broadcastDeletion(route, event.data, exceptConn);
        return;
      case "UPDATE":
        this.broadcastUpdate(route, event.data, exceptConn);
        return;
      default: {
        const action = (event as { action?: string }).action || 'unknown';
        throw new Error(`Unsupported broadcast action: ${action}`);
      }
    }
  }

  /**
   * Broadcast a DELETE message to all subscribed clients
   * @param route - The route to broadcast to
   * @param payload - The payload to send
   * @param exceptConn - Optional connection to exclude from the broadcast
   */
  broadcastDeletion(route: string, payload: Payload, exceptConn?: ServerConnection): void {
    this.internalBroadcast(route, "DELETE", payload, exceptConn);
  }

  /**
   * Broadcast an UPDATE message to all subscribed clients
   * @param route - The route to broadcast to
   * @param payload - The payload to send
   * @param exceptConn - Optional connection to exclude from the broadcast
   */
  broadcastUpdate(route: string, payload: Payload, exceptConn?: ServerConnection): void {
    this.internalBroadcast(route, "UPDATE", payload, exceptConn);
  }

  /**
   * Handle a new connection
   * @param transport - The communication transport to use
   * @param reconnectSecret - Optional secret for reconnection
   * @returns The new connection
   */
  public async handleNewConnection(
    transport: CommunicationTransport,
    reconnectSecret: ConnectionSecret | null = null,
    allowActiveReplacement = false,
    identity: ConnectionIdentity | null = null,
  ): Promise<ServerConnection> {
    if (reconnectSecret && (this.connections[reconnectSecret] || this.pendingRemovals[reconnectSecret])) {
      // Handle duplicate connection by reusing existing connection instance
      // to preserve subscriptions and state.
      const existingConn = this.connections[reconnectSecret];

      // If there's a pending removal, cancel it
      if (this.pendingRemovals[reconnectSecret]) {
        clearTimeout(this.pendingRemovals[reconnectSecret]);
        delete this.pendingRemovals[reconnectSecret];
      }

      if (existingConn) {
        this.assertSameIdentity(existingConn, identity);
        if (existingConn.getTransport().isConnected() && !allowActiveReplacement) {
          throw new Error('A connection with this reconnect secret is already active');
        }
        // Update the communication transport on the same connection object
        await existingConn.setTransport(transport);
        return existingConn;
      }

      // If we don't have existingConn yet (e.g., was pending removal), create anew
      const conn = this.createAndSetupConnection(transport, reconnectSecret, identity);
      return conn;
    } else {
      if (
        this.options.maxConnections !== false
        && Object.keys(this.connections).length >= this.options.maxConnections
      ) {
        throw new Error('Server connection limit reached');
      }
      // Create a new connection with a fresh secret
      const secret = reconnectSecret || newConnectionSecret();
      const conn = this.createAndSetupConnection(transport, secret, identity);
      
      return conn;
    }
  }

  /**
   * Create and set up a new connection with the given secret
   * @param transport - The communication transport
   * @param secret - The connection secret
   * @returns The configured connection
   */
  private createAndSetupConnection(
    transport: CommunicationTransport,
    secret: ConnectionSecret,
    identity: ConnectionIdentity | null,
  ): ServerConnection {
    const conn = new ServerConnection(
      transport,
      undefined,
      identity,
      this.options.maxMessagesPerSecond ?? 100,
    );
    
    // Set the secret and register the connection
    conn.setHeader('secret', secret);
    this.connections[secret] = conn;
    
    // Secret is already available in the connection URL, no need to send DATA_SET message
    
    // Set up connection handlers
    conn.onRouteMessage = async (msgId: MsgID, msg: MsgRoute) => {
      return await this.handleRouteMessage(conn.getSecret(), msgId, msg);
    };

    conn.onSubscribeToRoute = async (route) => {
      return this.subscribeConnectionToRoute(route, conn.getSecret());
    };

    conn.onUnsubscribeFromRoute = (route) => {
      this.unsubscribeConnectionFromRoute(route, conn.getSecret());
    };

    conn.onClose = () => {
      this.scheduleConnectionRemoval(conn.getSecret());
    };
    
    return conn;
  }

  /**
   * Clean up subscriptions for a connection
   * @param connSecret - The connection secret
   */
  private cleanupConnectionSubscriptions(connSecret: ConnectionSecret): void {
    for (const route of this.outRoutes) {
      route.listeners = route.listeners.filter((l) => l.conn !== connSecret);
    }
  }

  /**
   * Handle a route message
   * @param connSecret - The connection secret
   * @param msgId - The message ID
   * @param msg - The route message
   * @returns The response
   */
  protected async handleRouteMessage(
    connSecret: ConnectionSecret,
    msgId: MsgID,
    msg: MsgRoute,
  ): Promise<RouteResponse | void> {
    for (const route of this.inRoutes) {
      const match = route.match(msg.route);
      if (match) {
        let params: Record<string, string> = {};
        for (let i = 0; i < route.keys.length; i++) {
          params[route.keys[i]] = match.params[i];
        }

        const ctx = {
          params,
          data: msg.data,
          headers: msg.headers || {},
          sender: this.connections[connSecret],
          route: msg.route,
          response: undefined,
        } as RequestContext;

        const verbAndHandler = route.verbs.find((vh) => vh.verb === msg.verb);
        if (!verbAndHandler) {
          return {
            error: `Route "${msg.route}" does not support verb "${msg.verb}"`,
            data: null
          };
        }

        try {
          await verbAndHandler.handler(ctx);
        } catch (error) {
          console.error(`Error handling ${msg.verb} ${msg.route}`, error);
          return {
            error: 'Internal server error',
            data: null,
            status: 500,
          };
        }

        if (ctx.error) {
          return {
            error: ctx.error,
            data: null,
            status: ctx.statusCode || 500,
          };
        }

        return {
          data: ctx.response,
          status: ctx.statusCode || 200,
        };
      }
    }
    
    // No matching route found
    return {
      error: `Route "${msg.route}" not found`,
      data: null,
      status: 404,
    };
  }

  /**
   * Compute a specificity score for route matching precedence.
   * This follows web framework conventions where more specific routes (static segments)
   * take precedence over less specific ones (parameters, wildcards).
   * Used to resolve ambiguity when multiple routes could match a request.
   */
  private computeSpecificityScore(route: string, keys: string[]): number {
    const segments = route.split('/').filter(Boolean);
    let staticSegments = 0;
    let wildcardSegments = 0;
    for (const seg of segments) {
      if (seg.includes('*')) {
        wildcardSegments += 1;
      } else if (!seg.startsWith(':')) {
        staticSegments += 1;
      }
    }
    const paramSegments = keys.length;
    const lengthScore = Math.min(route.length, 999);
    // Higher is more specific.
    return staticSegments * 10000 - paramSegments * 100 - wildcardSegments * 1000 + lengthScore;
  }

  /**
   * Register an incoming route
   * @param route - The route pattern
   * @param verb - The HTTP verb
   * @param handler - The handler function
   * @returns The route subscription ID
   */
  private setInRoute(
    route: string,
    verb: RouteVerb,
    handler: (ctx: RequestContext) => void | Promise<void>,
  ): RouteSubID {
    const keys: Key[] = [];
    const regexp = pathToRegexp(route, keys);

    let targetRoute: InRouteLayer | undefined;
    for (const r of this.inRoutes) {
      if (String(r.regexp) === String(regexp)) {
        targetRoute = r;
        break;
      }
    }

    if (!targetRoute) {
      const keyNames = keys.map((k) => String(k.name));
      targetRoute = {
        id: this.nextRouteSubID++,
        route,
        regexp,
        match: match(regexp, { decode: decodeURIComponent }),
        keys: keyNames,
        specificity: this.computeSpecificityScore(route, keyNames),
        verbs: [],
      };

      this.inRoutes.push(targetRoute);
      // Keep routes ordered by specificity (most specific first)
      this.inRoutes.sort((a, b) => b.specificity - a.specificity);
    }

    const verbAndHandler = targetRoute.verbs.find((vh) => vh.verb === verb);
    if (!verbAndHandler) {
      targetRoute.verbs.push({
        verb,
        handler,
      });
    } else {
      // Replace existing handler
      verbAndHandler.handler = handler;
    }

    return targetRoute.id;
  }

  /**
   * Register an outgoing route
   * @param route - The route pattern
   * @param validate - The validation function
   * @returns The route subscription ID
   */
  private setOutRoute(
    route: string,
    validate: (
      conn: ServerConnection,
      params: Record<string, string>,
    ) => boolean | Promise<boolean>,
  ): RouteSubID {
    const keys: Key[] = [];
    const regexp = pathToRegexp(route, keys);

    let targetRoute: OutRouteLayer | undefined;
    for (const r of this.outRoutes) {
      if (String(r.regexp) === String(regexp)) {
        targetRoute = r;
        break;
      }
    }

    if (!targetRoute) {
      const keyNames = keys.map((k) => String(k.name));
      targetRoute = {
        id: this.nextRouteSubID++,
        route,
        regexp,
        match: match(regexp, { decode: decodeURIComponent }),
        keys: keyNames,
        specificity: this.computeSpecificityScore(route, keyNames),
        listeners: [],
        validate,
      };

      this.outRoutes.push(targetRoute);
      // Keep routes ordered by specificity (most specific first)
      this.outRoutes.sort((a, b) => b.specificity - a.specificity);
    } else {
      targetRoute.validate = validate;
    }

    return targetRoute.id;
  }

  /**
   * Subscribe a connection to a route
   * @param path - The route to subscribe to
   * @param connSecret - The connection secret
   */
  private async subscribeConnectionToRoute(
    path: string,
    connSecret: ConnectionSecret,
  ): Promise<SubscriptionAuthorizationResult> {
    if (!this.connections[connSecret]) {
      throw new Error(`Connection with id ${connSecret} does not exist`);
    }

    const conn = this.connections[connSecret];
    for (const layer of this.subscriptionAuthorizationRoutes) {
      const authorizationMatch = layer.match(path);
      if (!authorizationMatch) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < layer.keys.length; i++) {
        params[layer.keys[i]] = authorizationMatch.params[i];
      }
      const result = await layer.authorize(
        conn,
        params,
      );
      const normalized = typeof result === 'boolean'
        ? { allowed: result }
        : result;
      if (!normalized.allowed) {
        return {
          allowed: false,
          status: normalized.status || 403,
          error: normalized.error || 'Subscription forbidden',
        };
      }
      break;
    }

    // Subscribe to all matching out routes (internalBroadcast will ensure only
    // one delivery using the most specific route), avoiding duplicates.
    for (const route of this.outRoutes) {
      const m = route.match(path);
      if (!m) continue;
      const params = Object.values(m.params);

      const alreadySubscribed = route.listeners.some((l) => {
        if (l.conn !== connSecret) return false;
        if (l.params.length !== params.length) return false;
        for (let i = 0; i < l.params.length; i++) {
          if (l.params[i] !== params[i]) return false;
        }
        return true;
      });

      if (!alreadySubscribed) {
        route.listeners.push({
          conn: connSecret,
          params,
        });
      }
    }
    return { allowed: true };
  }

  /**
   * Unsubscribe a connection from a route
   * @param path - The route to unsubscribe from
   * @param connSecret - The connection secret
   */
  private unsubscribeConnectionFromRoute(path: string, connSecret: ConnectionSecret): void {
    if (!this.connections[connSecret]) {
      throw new Error(`Connection with id ${connSecret} does not exist`);
    }

    // Remove only the matching concrete subscription. A connection may listen
    // to multiple parameter values on the same route layer.
    for (const route of this.outRoutes) {
      const matchResult = route.match(path);
      if (!matchResult) continue;
      const params = Object.values(matchResult.params);
      route.listeners = route.listeners.filter((listener) => {
        if (listener.conn !== connSecret || listener.params.length !== params.length) {
          return true;
        }
        return listener.params.some((value, index) => value !== params[index]);
      });
    }
  }

  /**
   * Broadcast a message to all subscribed clients
   * @param route - The route to broadcast to
   * @param action - The action to perform
   * @param payload - The payload to send
   * @param exceptConn - Optional connection to exclude from the broadcast
   */
  private internalBroadcast(
    route: string,
    action: "POST" | "DELETE" | "UPDATE",
    payload: Payload,
    exceptConn?: ServerConnection,
  ): void {
    const verb = action as RouteVerb;
    // Identify the most specific matching out route and broadcast only once.
    let best: { layer: OutRouteLayer; match: MatchResult } | null = null;
    for (const layer of this.outRoutes) {
      const m = layer.match(route);
      if (!m) continue;
      if (!best || layer.specificity > best.layer.specificity) {
        best = { layer, match: m };
      }
    }

    if (!best) return;

    const paramsArr = Object.values(best.match.params);
    const params: Record<string, string> = {};
    for (let i = 0; i < best.layer.keys.length; i++) {
      params[best.layer.keys[i]] = best.match.params[i];
    }
    for (const listener of best.layer.listeners) {
      const conn = this.connections[listener.conn];
      if (!conn || conn === exceptConn) continue;

      // Ensure listener params match broadcast params
      let paramsMatch = listener.params.length === paramsArr.length;
      for (let i = 0; paramsMatch && i < listener.params.length; i++) {
        if (listener.params[i] !== paramsArr[i]) paramsMatch = false;
      }
      if (!paramsMatch) continue;

      const isValidForListener = best.layer.validate(
        conn,
        params,
      );
      if (isValidForListener instanceof Promise) {
        isValidForListener.then((isValid) => {
          if (isValid) {
            conn.sendToRoute(route, verb, payload);
          }
        }).catch((error) => {
          console.error(`Broadcast validation failed for route "${route}"`, error);
        });
      } else if (isValidForListener) {
        conn.sendToRoute(route, verb, payload);
      }
    }
  }

  /**
   * Remove a connection
   * @param connSecret - The connection secret
   */
  private removeConnection(connSecret: ConnectionSecret): void {
    // Clear any pending removal for this connection
    if (this.pendingRemovals[connSecret]) {
      clearTimeout(this.pendingRemovals[connSecret]);
      delete this.pendingRemovals[connSecret];
    }

    // Clean up live rooms and subscriptions before removing the connection.
    const connection = this.connections[connSecret];
    if (connection) {
      this.liveServers.removeConnection(connection);
      this.liveRooms.removeConnection(connection);
    }
    this.cleanupConnectionSubscriptions(connSecret);
    delete this.connections[connSecret];
  }

  /**
   * Schedule a connection for removal with a grace period for reconnection
   * @param connSecret - The connection secret
   */
  private scheduleConnectionRemoval(connSecret: ConnectionSecret): void {
    // Clear any existing pending removal
    if (this.pendingRemovals[connSecret]) {
      clearTimeout(this.pendingRemovals[connSecret]);
    }

    // Schedule removal after grace period
    this.pendingRemovals[connSecret] = setTimeout(() => {
      this.removeConnection(connSecret);
      delete this.pendingRemovals[connSecret];
    }, this.options.connectionGracePeriodMs);
  }

  /**
   * Execute a route directly for plain HTTP requests (no persistent sender connection).
   * Returns status and body suitable for HTTP responses.
   */
  public async executeHttpRoute(
    verb: 'GET' | 'POST' | 'DELETE',
    path: string,
    data: Payload,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Payload; contentType?: string }> {
    // Create a synthetic sender connection that is not registered in this.connections.
    // This allows handlers that pass ctx.sender to broadcast exclusion to work without errors,
    // though no actual exclusion will occur since the synthetic connection is not tracked.
    const syntheticSender = undefined as unknown as ServerConnection;

    for (const route of this.inRoutes) {
      const matchResult = route.match(path);
      if (matchResult) {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.keys.length; i++) {
          params[route.keys[i]] = matchResult.params[i];
        }

        const ctx = {
          params,
          data,
          headers: headers || {},
          sender: syntheticSender,
          route: path,
          response: undefined,
        } as RequestContext;

        const verbAndHandler = route.verbs.find((vh) => vh.verb === verb);
        if (!verbAndHandler) {
          return { status: 405, body: { error: `Method ${verb} not allowed for ${path}` } };
        }

        try {
          await verbAndHandler.handler(ctx);
        } catch (error) {
          console.error(`Error handling HTTP ${verb} ${path}`, error);
          return {
            status: 500,
            body: { error: 'Internal server error' },
            contentType: 'application/json',
          };
        }

        if (ctx.error) {
          return { status: ctx.statusCode || 500, body: { error: ctx.error } };
        }

        // Default to JSON content
        return { status: ctx.statusCode || 200, body: ctx.response, contentType: 'application/json' };
      }
    }

    return { status: 404, body: { error: 'Not found' }, contentType: 'application/json' };
  }

  public hasHttpRoute(path: string): boolean {
    return this.inRoutes.some((route) => Boolean(route.match(path)));
  }

  public canAcceptConnection(reconnectSecret: ConnectionSecret | null = null): boolean {
    if (
      reconnectSecret
      && (this.connections[reconnectSecret] || this.pendingRemovals[reconnectSecret])
    ) {
      return true;
    }
    return (
      this.options.maxConnections === false
      || Object.keys(this.connections).length < this.options.maxConnections
    );
  }

  private assertSameIdentity(
    connection: ServerConnection,
    identity: ConnectionIdentity | null,
  ): void {
    const existingIdentity = connection.getIdentity();
    if (existingIdentity?.id !== identity?.id) {
      throw new Error('Connection identity does not match the existing session');
    }
  }

  private validateLimits(): void {
    for (const [name, value] of [
      ['maxMessagesPerSecond', this.options.maxMessagesPerSecond],
      ['maxConnections', this.options.maxConnections],
    ] as const) {
      if (value !== false && (!Number.isInteger(value) || value <= 0)) {
        throw new Error(`${name} must be a positive integer or false`);
      }
    }
    if (
      !Number.isInteger(this.options.connectionGracePeriodMs)
      || this.options.connectionGracePeriodMs < 0
    ) {
      throw new Error('connectionGracePeriodMs must be a non-negative integer');
    }
  }
}

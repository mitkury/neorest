import type {
  ConnectionSecret,
  MsgID,
  MsgRoute,
  Payload,
  RouteResponse,
  RouteVerb,
  CommunicationStrategy
} from '@neorest/core';
import { newConnectionSecret } from '@neorest/core';
import { ServerConnection } from './ServerConnection';
import { 
  Key,
  match,
  MatchFunction,
  pathToRegexp,
} from './utils/pathToRegexp';

/**
 * Router options
 */
export interface RouterOptions {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  validateRoutes?: boolean;
}

/**
 * Server adapter interface for platform-specific server implementations
 */
export interface ServerAdapter {
  /**
   * Initialize the server
   * @param router - The router instance
   * @returns A promise that resolves when the server is initialized
   */
  initialize(router: Router): Promise<void>;
  
  /**
   * Start the server
   * @returns A promise that resolves when the server is started
   */
  start(): Promise<void>;
  
  /**
   * Stop the server
   * @returns A promise that resolves when the server is stopped
   */
  stop(): Promise<void>;
}

/**
 * Request context for route handlers
 */
export interface RequestContext {
  params: Record<string, string>;
  data: any;
  headers: Record<string, string>;
  sender: ServerConnection;
  route: string;
  response?: any;
  error?: string;
  statusCode?: number;
}

/**
 * Type for incoming route layer
 */
interface InRouteLayer {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  specificity: number;
  verbs: Array<{
    verb: RouteVerb;
    handler: (ctx: RequestContext) => void | Promise<void>;
  }>;
}

/**
 * Type for outgoing route layer
 */
interface OutRouteLayer {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  specificity: number;
  listeners: Array<{
    conn: ConnectionSecret;
    params: string[];
  }>;
  validate: (
    conn: ServerConnection,
    params: Record<string, string>,
  ) => boolean | Promise<boolean>;
}

/**
 * Type for route subscription ID
 */
type RouteSubID = number;

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
   * Routes that the router uses to handle incoming messages
   */
  private inRoutes: InRouteLayer[] = [];
  
  /**
   * Routes that the router uses to send messages to the clients
   */
  private outRoutes: OutRouteLayer[] = [];
  
  /**
   * Router options
   */
  protected options: RouterOptions;

  /**
   * Server adapter for platform-specific implementation
   */
  protected serverAdapter?: ServerAdapter;

  /**
   * Constructor
   * @param options - Router options
   */
  constructor(options?: RouterOptions) {
    this.options = {
      logLevel: 'info',
      validateRoutes: true,
      ...options
    };
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
   * Stop the server
   * @returns A promise that resolves when the server is stopped
   */
  async close(): Promise<void> {
    if (this.serverAdapter) {
      await this.serverAdapter.stop();
    }
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
   * @param strategy - The communication strategy to use
   * @param reconnectSecret - Optional secret for reconnection
   * @returns The new connection
   */
  public handleNewConnection(
    strategy: CommunicationStrategy, 
    reconnectSecret: ConnectionSecret | null = null
  ): ServerConnection {
    if (reconnectSecret && this.connections[reconnectSecret]) {
      // Handle duplicate connection - disconnect the existing one
      const existingConn = this.connections[reconnectSecret];
      console.log(`Replacing existing connection for secret: ${reconnectSecret}`);
      
      // Gracefully close the existing connection
      existingConn.close();
      this.removeConnection(reconnectSecret);
    }

    if (reconnectSecret) {
      console.log(`Creating new connection for secret: ${reconnectSecret}`);
    }

    const conn = new ServerConnection(strategy, (data) => {
      if (data[0] === "secret") {
        const secret = data[1] as ConnectionSecret;
        this.connections[secret] = conn;
      }
    });

    // Set up connection handlers
    conn.onRouteMessage = async (msgId: MsgID, msg: MsgRoute) => {
      return await this.handleRouteMessage(conn.getSecret(), msgId, msg);
    };

    conn.onSubscribeToRoute = (route) => {
      this.subscribeConnectionToRoute(route, conn.getSecret());
    };

    conn.onUnsubscribeFromRoute = (route) => {
      this.unsubscribeConnectionFromRoute(route, conn.getSecret());
    };

    conn.onClose = () => {
      this.removeConnection(conn.getSecret());
    };
    
    return conn;
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
        } as RequestContext;

        const verbAndHandler = route.verbs.find((vh) => vh.verb === msg.verb);
        if (!verbAndHandler) {
          return {
            error: `Route "${msg.route}" does not support verb "${msg.verb}"`,
            data: null
          };
        }

        await verbAndHandler.handler(ctx);

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
    }

    return targetRoute.id;
  }

  /**
   * Subscribe a connection to a route
   * @param path - The route to subscribe to
   * @param connSecret - The connection secret
   */
  private subscribeConnectionToRoute(path: string, connSecret: ConnectionSecret): void {
    if (!this.connections[connSecret]) {
      throw new Error(`Connection with id ${connSecret} does not exist`);
    }

    // Find the most specific matching route and subscribe only to that
    let best: { route: OutRouteLayer; params: string[] } | null = null;
    for (const route of this.outRoutes) {
      const m = route.match(path);
      if (m) {
        const params = Object.values(m.params);
        if (!best || route.specificity > best.route.specificity) {
          best = { route, params };
        }
      }
    }

    if (best) {
      best.route.listeners.push({
        conn: connSecret,
        params: best.params,
      });
    }
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

    // Remove from any matching route (in case of prior multiple subscriptions)
    for (const route of this.outRoutes) {
      const match = route.match(path);
      if (match) {
        route.listeners = route.listeners.filter((l) => l.conn !== connSecret);
      }
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

    for (const r of this.outRoutes) {
      const match = r.match(route);
      if (match) {
        const paramsArr = Object.values(match.params);
        for (const listener of r.listeners) {
          const conn = this.connections[listener.conn];
          if (conn !== exceptConn) {
            // Make sure the params match.
            // That means that the listener is subscribed to the exact same route
            let paramsMatch = true;
            for (let i = 0; i < listener.params.length; i++) {
              if (listener.params[i] !== paramsArr[i]) {
                paramsMatch = false;
                break;
              }
            }

            if (paramsMatch) {
              const isValidForListener = r.validate(
                conn,
                match.params as Record<string, string>,
              );
              if (isValidForListener instanceof Promise) {
                isValidForListener.then((isValid) => {
                  if (isValid) {
                    conn.sendToRoute(route, verb, payload);
                  }
                });
              } else if (isValidForListener) {
                conn.sendToRoute(route, verb, payload);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Remove a connection
   * @param connSecret - The connection secret
   */
  private removeConnection(connSecret: ConnectionSecret): void {
    delete this.connections[connSecret];

    for (const route of this.outRoutes) {
      route.listeners = route.listeners.filter((l) => l.conn !== connSecret);
    }
  }

  /**
   * Execute a route directly for plain HTTP requests (no persistent sender connection).
   * Returns status and body suitable for HTTP responses.
   */
  public async executeHttpRoute(
    verb: 'GET' | 'POST' | 'DELETE',
    path: string,
    data: any,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: any; contentType?: string }> {
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
        } as RequestContext;

        const verbAndHandler = route.verbs.find((vh) => vh.verb === (verb as any));
        if (!verbAndHandler) {
          return { status: 405, body: { error: `Method ${verb} not allowed for ${path}` } };
        }

        await verbAndHandler.handler(ctx);

        if (ctx.error) {
          return { status: ctx.statusCode || 500, body: { error: ctx.error } };
        }

        // Default to JSON content
        return { status: ctx.statusCode || 200, body: ctx.response, contentType: 'application/json' };
      }
    }

    return { status: 404, body: { error: 'Not found' }, contentType: 'application/json' };
  }
}
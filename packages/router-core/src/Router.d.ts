import type { ConnectionSecret, MsgID, MsgRoute, Payload, RouteResponse, CommunicationStrategy } from '@neorest/core';
import { ServerConnection } from './ServerConnection';
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
}
/**
 * Core router implementation that can be used with any server adapter
 */
export declare class Router {
    /**
     * The next route subscription id
     */
    private nextRouteSubID;
    /**
     * All the active connections that the router has
     */
    protected connections: Record<ConnectionSecret, ServerConnection>;
    /**
     * Routes that the router uses to handle incoming messages
     */
    private inRoutes;
    /**
     * Routes that the router uses to send messages to the clients
     */
    private outRoutes;
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
    constructor(options?: RouterOptions);
    /**
     * Set the server adapter
     * @param adapter - The server adapter
     * @returns This router instance for chaining
     */
    setServerAdapter(adapter: ServerAdapter): this;
    /**
     * Start the server
     * @returns A promise that resolves when the server is started
     */
    listen(): Promise<void>;
    /**
     * Stop the server
     * @returns A promise that resolves when the server is stopped
     */
    close(): Promise<void>;
    /**
     * Register a GET handler for a route
     * @param route - The route pattern
     * @param handler - The handler function
     * @returns This router instance for chaining
     */
    onGet(route: string, handler: (ctx: RequestContext) => void | Promise<void>): this;
    /**
     * Register a POST handler for a route
     * @param route - The route pattern
     * @param handler - The handler function
     * @returns This router instance for chaining
     */
    onPost(route: string, handler: (ctx: RequestContext) => void | Promise<void>): this;
    /**
     * Register a DELETE handler for a route
     * @param route - The route pattern
     * @param handler - The handler function
     * @returns This router instance for chaining
     */
    onDelete(route: string, handler: (ctx: RequestContext) => void | Promise<void>): this;
    /**
     * Register a validation function for broadcast messages
     * @param route - The route pattern
     * @param validate - The validation function
     * @returns This router instance for chaining
     */
    onValidateBroadcast(route: string, validate: (conn: ServerConnection, params: Record<string, string>) => boolean | Promise<boolean>): this;
    /**
     * Send a POST message to a specific connection
     * @param route - The route to send to
     * @param conn - The connection to send to
     * @param payload - The payload to send
     */
    post(route: string, conn: ServerConnection, payload: Payload): void;
    /**
     * Broadcast a POST message to all subscribed clients
     * @param route - The route to broadcast to
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    broadcastPost(route: string, payload: Payload, exceptConn?: ServerConnection): void;
    /**
     * Broadcast a DELETE message to all subscribed clients
     * @param route - The route to broadcast to
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    broadcastDeletion(route: string, payload: Payload, exceptConn?: ServerConnection): void;
    /**
     * Broadcast an UPDATE message to all subscribed clients
     * @param route - The route to broadcast to
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    broadcastUpdate(route: string, payload: Payload, exceptConn?: ServerConnection): void;
    /**
     * Handle a new connection
     * @param strategy - The communication strategy to use
     * @param reconnectSecret - Optional secret for reconnection
     * @returns The new connection
     */
    handleNewConnection(strategy: CommunicationStrategy, reconnectSecret?: ConnectionSecret | null): ServerConnection;
    /**
     * Handle a route message
     * @param connSecret - The connection secret
     * @param msgId - The message ID
     * @param msg - The route message
     * @returns The response
     */
    protected handleRouteMessage(connSecret: ConnectionSecret, msgId: MsgID, msg: MsgRoute): Promise<RouteResponse | void>;
    /**
     * Register an incoming route
     * @param route - The route pattern
     * @param verb - The HTTP verb
     * @param handler - The handler function
     * @returns The route subscription ID
     */
    private setInRoute;
    /**
     * Register an outgoing route
     * @param route - The route pattern
     * @param validate - The validation function
     * @returns The route subscription ID
     */
    private setOutRoute;
    /**
     * Subscribe a connection to a route
     * @param path - The route to subscribe to
     * @param connSecret - The connection secret
     */
    private subscribeConnectionToRoute;
    /**
     * Unsubscribe a connection from a route
     * @param path - The route to unsubscribe from
     * @param connSecret - The connection secret
     */
    private unsubscribeConnectionFromRoute;
    /**
     * Broadcast a message to all subscribed clients
     * @param route - The route to broadcast to
     * @param action - The action to perform
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    private internalBroadcast;
    /**
     * Remove a connection
     * @param connSecret - The connection secret
     */
    private removeConnection;
}
//# sourceMappingURL=Router.d.ts.map
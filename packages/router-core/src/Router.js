import { ServerConnection } from './ServerConnection';
import { match, pathToRegexp, } from './utils/pathToRegexp';
/**
 * Core router implementation that can be used with any server adapter
 */
export class Router {
    /**
     * Constructor
     * @param options - Router options
     */
    constructor(options) {
        /**
         * The next route subscription id
         */
        this.nextRouteSubID = 0;
        /**
         * All the active connections that the router has
         */
        this.connections = {};
        /**
         * Routes that the router uses to handle incoming messages
         */
        this.inRoutes = [];
        /**
         * Routes that the router uses to send messages to the clients
         */
        this.outRoutes = [];
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
    setServerAdapter(adapter) {
        this.serverAdapter = adapter;
        return this;
    }
    /**
     * Start the server
     * @returns A promise that resolves when the server is started
     */
    async listen() {
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
    async close() {
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
    onGet(route, handler) {
        this.setInRoute(route, "GET", handler);
        return this;
    }
    /**
     * Register a POST handler for a route
     * @param route - The route pattern
     * @param handler - The handler function
     * @returns This router instance for chaining
     */
    onPost(route, handler) {
        this.setInRoute(route, "POST", handler);
        return this;
    }
    /**
     * Register a DELETE handler for a route
     * @param route - The route pattern
     * @param handler - The handler function
     * @returns This router instance for chaining
     */
    onDelete(route, handler) {
        this.setInRoute(route, "DELETE", handler);
        return this;
    }
    /**
     * Register a validation function for broadcast messages
     * @param route - The route pattern
     * @param validate - The validation function
     * @returns This router instance for chaining
     */
    onValidateBroadcast(route, validate) {
        this.setOutRoute(route, validate);
        return this;
    }
    /**
     * Send a POST message to a specific connection
     * @param route - The route to send to
     * @param conn - The connection to send to
     * @param payload - The payload to send
     */
    post(route, conn, payload) {
        this.connections[conn.getSecret()].sendToRoute(route, "POST", payload);
    }
    /**
     * Broadcast a POST message to all subscribed clients
     * @param route - The route to broadcast to
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    broadcastPost(route, payload, exceptConn) {
        this.internalBroadcast(route, "POST", payload, exceptConn);
    }
    /**
     * Broadcast a DELETE message to all subscribed clients
     * @param route - The route to broadcast to
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    broadcastDeletion(route, payload, exceptConn) {
        this.internalBroadcast(route, "DELETE", payload, exceptConn);
    }
    /**
     * Broadcast an UPDATE message to all subscribed clients
     * @param route - The route to broadcast to
     * @param payload - The payload to send
     * @param exceptConn - Optional connection to exclude from the broadcast
     */
    broadcastUpdate(route, payload, exceptConn) {
        this.internalBroadcast(route, "UPDATE", payload, exceptConn);
    }
    /**
     * Handle a new connection
     * @param strategy - The communication strategy to use
     * @param reconnectSecret - Optional secret for reconnection
     * @returns The new connection
     */
    handleNewConnection(strategy, reconnectSecret = null) {
        if (reconnectSecret && this.connections[reconnectSecret]) {
            // Reconnect using existing connection
            // This is a placeholder - actual implementation would depend on strategy
            throw new Error("Reconnection not implemented yet");
        }
        else {
            if (reconnectSecret) {
                console.error("Reconnect secret provided, but no connection found");
            }
            const conn = new ServerConnection(strategy, (data) => {
                if (data[0] === "secret") {
                    const secret = data[1];
                    this.connections[secret] = conn;
                }
            });
            conn.onRouteMessage = async (msgId, msg) => {
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
    }
    /**
     * Handle a route message
     * @param connSecret - The connection secret
     * @param msgId - The message ID
     * @param msg - The route message
     * @returns The response
     */
    async handleRouteMessage(connSecret, msgId, msg) {
        for (const route of this.inRoutes) {
            const match = route.match(msg.route);
            if (match) {
                let params = {};
                for (let i = 0; i < route.keys.length; i++) {
                    params[route.keys[i]] = match.params[i];
                }
                const ctx = {
                    params,
                    data: msg.data,
                    headers: msg.headers || {},
                    sender: this.connections[connSecret],
                    route: msg.route,
                };
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
                        data: null
                    };
                }
                return {
                    data: ctx.response
                };
            }
        }
        // No matching route found
        return {
            error: `Route "${msg.route}" not found`,
            data: null
        };
    }
    /**
     * Register an incoming route
     * @param route - The route pattern
     * @param verb - The HTTP verb
     * @param handler - The handler function
     * @returns The route subscription ID
     */
    setInRoute(route, verb, handler) {
        const keys = [];
        const regexp = pathToRegexp(route, keys);
        let targetRoute;
        for (const r of this.inRoutes) {
            if (String(r.regexp) === String(regexp)) {
                targetRoute = r;
                break;
            }
        }
        if (!targetRoute) {
            targetRoute = {
                id: this.nextRouteSubID++,
                route,
                regexp,
                match: match(regexp, { decode: decodeURIComponent }),
                keys: keys.map((k) => String(k.name)),
                verbs: [],
            };
            this.inRoutes.push(targetRoute);
        }
        const verbAndHandler = targetRoute.verbs.find((vh) => vh.verb === verb);
        if (!verbAndHandler) {
            targetRoute.verbs.push({
                verb,
                handler,
            });
        }
        else {
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
    setOutRoute(route, validate) {
        const keys = [];
        const regexp = pathToRegexp(route, keys);
        let targetRoute;
        for (const r of this.outRoutes) {
            if (String(r.regexp) === String(regexp)) {
                targetRoute = r;
                break;
            }
        }
        if (!targetRoute) {
            targetRoute = {
                id: this.nextRouteSubID++,
                route,
                regexp,
                match: match(regexp, { decode: decodeURIComponent }),
                keys: keys.map((k) => String(k.name)),
                listeners: [],
                validate,
            };
            this.outRoutes.push(targetRoute);
        }
        return targetRoute.id;
    }
    /**
     * Subscribe a connection to a route
     * @param path - The route to subscribe to
     * @param connSecret - The connection secret
     */
    subscribeConnectionToRoute(path, connSecret) {
        if (!this.connections[connSecret]) {
            throw new Error(`Connection with id ${connSecret} does not exist`);
        }
        for (const route of this.outRoutes) {
            const match = route.match(path);
            if (match) {
                route.listeners.push({
                    conn: connSecret,
                    params: Object.values(match.params),
                });
            }
        }
    }
    /**
     * Unsubscribe a connection from a route
     * @param path - The route to unsubscribe from
     * @param connSecret - The connection secret
     */
    unsubscribeConnectionFromRoute(path, connSecret) {
        if (!this.connections[connSecret]) {
            throw new Error(`Connection with id ${connSecret} does not exist`);
        }
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
    internalBroadcast(route, action, payload, exceptConn) {
        const verb = action;
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
                            const isValidForListener = r.validate(conn, match.params);
                            if (isValidForListener instanceof Promise) {
                                isValidForListener.then((isValid) => {
                                    if (isValid) {
                                        conn.sendToRoute(route, verb, payload);
                                    }
                                });
                            }
                            else if (isValidForListener) {
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
    removeConnection(connSecret) {
        delete this.connections[connSecret];
        for (const route of this.outRoutes) {
            route.listeners = route.listeners.filter((l) => l.conn !== connSecret);
        }
    }
}
//# sourceMappingURL=Router.js.map
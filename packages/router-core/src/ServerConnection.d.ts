import { ConnectionBase, CommunicationStrategy, MsgID, MsgRoute, RouteResponse, Payload, RouteVerb, ConnectionSecret } from '@neorest/core';
/**
 * Server-side connection implementation
 */
export declare class ServerConnection extends ConnectionBase {
    private static CLOSE_ON_SERVER_AFTER_MS;
    /**
     * Callback for handling route messages
     */
    onRouteMessage: (msgId: MsgID, msg: MsgRoute) => Promise<RouteResponse | void>;
    /**
     * Callback for handling route subscriptions
     */
    onSubscribeToRoute: (route: string) => void;
    /**
     * Callback for handling route unsubscriptions
     */
    onUnsubscribeFromRoute: (route: string) => void;
    /**
     * Constructor
     * @param strategy - The communication strategy to use
     * @param onDataSet - Callback for handling data set messages
     */
    constructor(strategy: CommunicationStrategy, onDataSet?: (data: [string, Payload]) => void);
    /**
     * Get the connection secret
     * @returns The connection secret
     */
    getSecret(): ConnectionSecret;
    /**
     * Send a message to a route
     * @param route - The route to send to
     * @param verb - The HTTP verb to use
     * @param payload - The payload to send
     * @param headers - Optional headers
     */
    sendToRoute(route: string, verb: RouteVerb, payload: Payload, headers?: Record<string, string>): void;
    /**
     * Register handlers for route-related messages
     */
    private registerRouteHandlers;
    /**
     * Set up server-side close timeout
     */
    private setupServerCloseTimeout;
}
//# sourceMappingURL=ServerConnection.d.ts.map
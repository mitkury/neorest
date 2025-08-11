import { ConnectionBase, ROUTE_MESSAGE, ON_ROUTE, OFF_ROUTE, new_MsgResponseOK, new_MsgGenericError } from '@neorest/core';
/**
 * Server-side connection implementation
 */
export class ServerConnection extends ConnectionBase {
    /**
     * Constructor
     * @param strategy - The communication strategy to use
     * @param onDataSet - Callback for handling data set messages
     */
    constructor(strategy, onDataSet = () => { }) {
        super(strategy);
        /**
         * Callback for handling route messages
         */
        this.onRouteMessage = async () => { };
        /**
         * Callback for handling route subscriptions
         */
        this.onSubscribeToRoute = () => { };
        /**
         * Callback for handling route unsubscriptions
         */
        this.onUnsubscribeFromRoute = () => { };
        this.onDataSet = onDataSet;
        this.registerRouteHandlers();
        this.setupServerCloseTimeout();
    }
    /**
     * Get the connection secret
     * @returns The connection secret
     */
    getSecret() {
        return this.getHeader('secret') || '';
    }
    /**
     * Send a message to a route
     * @param route - The route to send to
     * @param verb - The HTTP verb to use
     * @param payload - The payload to send
     * @param headers - Optional headers
     */
    sendToRoute(route, verb, payload, headers) {
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
     * Register handlers for route-related messages
     */
    registerRouteHandlers() {
        // Handler for route messages
        this.registerHandler(ROUTE_MESSAGE, async (msgId, msg) => {
            const routeMsg = msg;
            const response = await this.onRouteMessage(msgId, routeMsg);
            if (!response) {
                return new_MsgResponseOK(msgId);
            }
            else {
                if (!response.error) {
                    return new_MsgResponseOK(msgId, response.data);
                }
                else {
                    return new_MsgGenericError(msgId, response.error);
                }
            }
        });
        // Handler for subscription messages
        this.registerHandler(ON_ROUTE, (msgId, msg) => {
            const subMsg = msg;
            this.onSubscribeToRoute(subMsg.route);
            return new_MsgResponseOK(msgId);
        });
        // Handler for unsubscription messages
        this.registerHandler(OFF_ROUTE, (msgId, msg) => {
            const unsubMsg = msg;
            this.onUnsubscribeFromRoute(unsubMsg.route);
            return new_MsgResponseOK(msgId);
        });
    }
    /**
     * Set up server-side close timeout
     */
    setupServerCloseTimeout() {
        const originalOnClose = this.onClose;
        this.onClose = () => {
            this.clearClosingTimer();
            this.closingTimer = setTimeout(() => {
                originalOnClose();
            }, ServerConnection.CLOSE_ON_SERVER_AFTER_MS);
        };
    }
}
ServerConnection.CLOSE_ON_SERVER_AFTER_MS = 5000;
//# sourceMappingURL=ServerConnection.js.map
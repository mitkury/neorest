/**
 * Message ID type
 */
export type MsgID = number;
/**
 * Special ID for messages that don't need a response
 */
export type SendAndForgetMsgID = -1;
/**
 * Connection secret used for authentication
 */
export type ConnectionSecret = string;
/**
 * Payload types that can be sent in messages
 */
export type Payload = object | string | number | boolean | undefined | null | object[] | string[] | number[] | boolean[];
/**
 * Record of sent messages awaiting acknowledgment
 */
export type SentMessages = {
    wrappedMsg: MsgWrapper;
    sentAt: number;
    sentAmount: number;
};
/**
 * HTTP verbs and special action types
 */
export type RouteVerb = "ANY" | "GET" | "POST" | "DELETE" | "LISTEN" | "RESPONSE";
/**
 * Base message interface
 */
export interface MsgType {
    type: string;
}
/**
 * Message that targets a specific route
 */
export interface MsgForRoute extends MsgType {
    route: string;
}
/**
 * Data set message type
 */
export declare const DATA_SET = "set";
/**
 * Message for setting data on a connection
 */
export interface MsgDataSet extends MsgType {
    type: typeof DATA_SET;
    key: string;
    value: Payload;
}
/**
 * Create a new data set message
 */
export declare function msg_ConnDataSet(key: string, value: Payload): MsgDataSet;
/**
 * Ping message type
 */
export declare const PING = "ping";
/**
 * Ping message interface
 */
export interface MsgPing extends MsgType {
    type: typeof PING;
}
/**
 * Reusable ping message
 */
export declare const pingMsg: MsgPing;
/**
 * Error message type
 */
export declare const ERROR = "err";
/**
 * Error message for a route
 */
export interface RouteError extends MsgForRoute {
    type: typeof ERROR;
    route: string;
    status: number;
    text: string;
}
/**
 * Subscription message type
 */
export declare const ON_ROUTE = "on";
/**
 * Message for subscribing to a route
 */
export interface MsgSubscribeToRoute extends MsgForRoute {
    type: typeof ON_ROUTE;
    route: string;
}
/**
 * Create a new subscription message
 */
export declare function new_MsgSubscribeToRoute(route: string): MsgSubscribeToRoute;
/**
 * Unsubscribe message type
 */
export declare const OFF_ROUTE = "off";
/**
 * Message for unsubscribing from a route
 */
export interface MsgUnsubscribeFromRoute extends MsgForRoute {
    type: typeof OFF_ROUTE;
    route: string;
}
/**
 * Create a new unsubscribe message
 */
export declare function new_MsgUnsubscribeFromRoute(route: string): MsgUnsubscribeFromRoute;
/**
 * Response message type
 */
export declare const RESPONSE = "res";
/**
 * Response message interface
 */
export interface MsgResponse extends MsgType {
    type: typeof RESPONSE;
    target: number;
    status: number;
    data: Payload;
}
/**
 * Create a new response message
 */
export declare function new_MsgResponse(targetMsgId: number, status: number, data: Payload): MsgResponse;
/**
 * Create a successful response message
 */
export declare function new_MsgResponseOK(targetMsgId: number, data?: Payload): MsgResponse;
/**
 * Create a response message with a specific status code
 */
export declare function new_MsgResponseWithCode(targetMsgId: number, status: number, text: string): MsgResponse;
/**
 * Create a not found response message
 */
export declare function new_MsgNotFound(targetMsgId: number, text: string): MsgResponse;
/**
 * Create a generic error response message
 */
export declare function new_MsgGenericError(targetMsgId: number, text: string): MsgResponse;
/**
 * Create a bad request response message
 */
export declare function new_MsgBadRequest(targetMsgId: number, text: string): MsgResponse;
/**
 * Generic route response interface
 */
export interface RouteResponse<T = any> {
    data: T;
    error?: string;
}
/**
 * Create a successful route response
 */
export declare function new_RouteResponse<T = any>(data: T): RouteResponse<T>;
/**
 * Create an error route response
 */
export declare function new_RouteResponseError(error: string): RouteResponse;
/**
 * Route message type
 */
export declare const ROUTE_MESSAGE = "route";
/**
 * Message for interacting with a route
 */
export interface MsgRoute extends MsgForRoute {
    type: typeof ROUTE_MESSAGE;
    verb: RouteVerb;
    route: string;
    data: Payload;
    headers?: Record<string, string>;
}
/**
 * Create a new route message
 */
export declare function new_MsgRoute(route: string, verb: RouteVerb | undefined, data: Payload, headers?: Record<string, string>): MsgRoute;
/**
 * Message wrapper interface
 */
export interface MsgWrapper {
    id: MsgID | SendAndForgetMsgID;
    msg: MsgType;
    meta?: {
        timestamp: number;
        version: string;
        auth?: string;
    };
}
/**
 * Create a new message wrapper
 */
export declare function new_MsgWrapper(id: MsgID, msg: MsgType): MsgWrapper;
/**
 * Create a message wrapper for a message that doesn't need a response
 */
export declare function new_SendAndForgetMsgWrapper(msg: MsgType): MsgWrapper;
/**
 * Options for client connection
 */
export interface ConnectionOptions {
    reconnect?: boolean | ReconnectOptions;
    timeout?: number;
    headers?: Record<string, string>;
}
/**
 * Options for reconnection
 */
export interface ReconnectOptions {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
}
/**
 * Event received from a subscription
 */
export interface BroadcastEvent<T = any> {
    action: "POST" | "DELETE" | "UPDATE";
    data: T;
}
//# sourceMappingURL=types.d.ts.map
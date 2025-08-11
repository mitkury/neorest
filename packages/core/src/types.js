/**
 * Data set message type
 */
export const DATA_SET = "set";
/**
 * Create a new data set message
 */
export function msg_ConnDataSet(key, value) {
    return {
        type: DATA_SET,
        key,
        value,
    };
}
/**
 * Ping message type
 */
export const PING = "ping";
/**
 * Reusable ping message
 */
export const pingMsg = {
    type: PING,
};
/**
 * Error message type
 */
export const ERROR = "err";
/**
 * Subscription message type
 */
export const ON_ROUTE = "on";
/**
 * Create a new subscription message
 */
export function new_MsgSubscribeToRoute(route) {
    return {
        type: ON_ROUTE,
        route,
    };
}
/**
 * Unsubscribe message type
 */
export const OFF_ROUTE = "off";
/**
 * Create a new unsubscribe message
 */
export function new_MsgUnsubscribeFromRoute(route) {
    return {
        type: OFF_ROUTE,
        route,
    };
}
/**
 * Response message type
 */
export const RESPONSE = "res";
/**
 * Create a new response message
 */
export function new_MsgResponse(targetMsgId, status, data) {
    return {
        type: RESPONSE,
        target: targetMsgId,
        status,
        data,
    };
}
/**
 * Create a successful response message
 */
export function new_MsgResponseOK(targetMsgId, data) {
    return new_MsgResponse(targetMsgId, 200, data !== undefined ? data : "OK");
}
/**
 * Create a response message with a specific status code
 */
export function new_MsgResponseWithCode(targetMsgId, status, text) {
    return {
        type: RESPONSE,
        target: targetMsgId,
        status,
        data: text,
    };
}
/**
 * Create a not found response message
 */
export function new_MsgNotFound(targetMsgId, text) {
    return new_MsgResponseWithCode(targetMsgId, 404, text);
}
/**
 * Create a generic error response message
 */
export function new_MsgGenericError(targetMsgId, text) {
    return new_MsgResponseWithCode(targetMsgId, 500, text);
}
/**
 * Create a bad request response message
 */
export function new_MsgBadRequest(targetMsgId, text) {
    return new_MsgResponseWithCode(targetMsgId, 400, text);
}
/**
 * Create a successful route response
 */
export function new_RouteResponse(data) {
    return {
        data,
    };
}
/**
 * Create an error route response
 */
export function new_RouteResponseError(error) {
    return {
        error,
        data: '',
    };
}
/**
 * Route message type
 */
export const ROUTE_MESSAGE = "route";
/**
 * Create a new route message
 */
export function new_MsgRoute(route, verb = "ANY", data, headers) {
    return {
        type: ROUTE_MESSAGE,
        verb,
        route,
        data,
        headers
    };
}
/**
 * Create a new message wrapper
 */
export function new_MsgWrapper(id, msg) {
    return {
        id,
        msg,
        meta: {
            timestamp: Date.now(),
            version: '1.0.0'
        }
    };
}
/**
 * Create a message wrapper for a message that doesn't need a response
 */
export function new_SendAndForgetMsgWrapper(msg) {
    return {
        // id: -1 means that the message doesn't have an identifier and doesn't expect a response.
        id: -1,
        msg,
        meta: {
            timestamp: Date.now(),
            version: '1.0.0'
        }
    };
}
//# sourceMappingURL=types.js.map
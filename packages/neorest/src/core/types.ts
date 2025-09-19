/**
 * Forward declarations to avoid circular dependencies
 */
declare class ServerConnection {
  send(message: any): void;
  isConnected(): boolean;
  disconnect(): void;
}

declare class Router {
  // Router methods will be defined where needed
}

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
}

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
export const DATA_SET = "set";

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
export function msg_ConnDataSet(key: string, value: Payload): MsgDataSet {
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
 * Ping message interface
 */
export interface MsgPing extends MsgType {
  type: typeof PING;
}

/**
 * Reusable ping message
 */
export const pingMsg: MsgPing = {
  type: PING,
}

/**
 * Error message type
 */
export const ERROR = "err";

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
export const ON_ROUTE = "on";

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
export function new_MsgSubscribeToRoute(route: string): MsgSubscribeToRoute {
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
 * Message for unsubscribing from a route
 */
export interface MsgUnsubscribeFromRoute extends MsgForRoute {
  type: typeof OFF_ROUTE;
  route: string;
}

/**
 * Create a new unsubscribe message
 */
export function new_MsgUnsubscribeFromRoute(route: string): MsgUnsubscribeFromRoute {
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
export function new_MsgResponse(targetMsgId: number, status: number, data: Payload): MsgResponse {
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
export function new_MsgResponseOK(targetMsgId: number, data?: Payload): MsgResponse {
  return new_MsgResponse(targetMsgId, 200, data !== undefined ? data : "OK");
}

/**
 * Create a response message with a specific status code
 */
export function new_MsgResponseWithCode(targetMsgId: number, status: number, text: string): MsgResponse {
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
export function new_MsgNotFound(targetMsgId: number, text: string): MsgResponse {
  return new_MsgResponseWithCode(targetMsgId, 404, text);
}

/**
 * Create a generic error response message
 */
export function new_MsgGenericError(targetMsgId: number, text: string): MsgResponse {
  return new_MsgResponseWithCode(targetMsgId, 500, text);
}

/**
 * Create a bad request response message
 */
export function new_MsgBadRequest(targetMsgId: number, text: string): MsgResponse {
  return new_MsgResponseWithCode(targetMsgId, 400, text);
}

/**
 * Generic route response interface
 */
export interface RouteResponse<T = any> {
  data: T;
  error?: string;
  status?: number;
}

/**
 * Create a successful route response
 */
export function new_RouteResponse<T = any>(data: T): RouteResponse<T> {
  return {
    data,
  };
}

/**
 * Create an error route response
 */
export function new_RouteResponseError(error: string): RouteResponse {
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
export function new_MsgRoute(
  route: string,
  verb: RouteVerb = "ANY",
  data: Payload,
  headers?: Record<string, string>,
): MsgRoute {
  return {
    type: ROUTE_MESSAGE,
    verb,
    route,
    data,
    headers
  };
}

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
export function new_MsgWrapper(id: MsgID, msg: MsgType): MsgWrapper {
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
export function new_SendAndForgetMsgWrapper(msg: MsgType): MsgWrapper {
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

// Router-specific types
import { MatchFunction } from './utils/pathToRegexp';

/**
 * Route subscription ID
 */
export type RouteSubID = number;

/**
 * A listener for a route
 */
export type RouteListener = {
  conn: ConnectionSecret;
  params: string[];
};

/**
 * A verb and handler pair
 */
export type VerbAndHandler = {
  verb: RouteVerb;
  handler: RouteHandler;
};

/**
 * A route handler function
 */
export type RouteHandler = (ctx: RequestContext) => void | Promise<void>;

/**
 * An incoming route layer
 */
export type InRouteLayer = {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  specificity: number;
  verbs: VerbAndHandler[];
};

/**
 * An outgoing route layer
 */
export type OutRouteLayer = {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  specificity: number;
  listeners: RouteListener[];
  validate: (
    conn: ServerConnection,
    params: Record<string, string>,
  ) => boolean | Promise<boolean>;
};

/**
 * Request context for route handlers
 */
export interface RequestContext {
  params: Record<string, string>;
  sender: ServerConnection;
  data: Payload;
  headers: Record<string, string>;
  error?: string;
  response: Payload;
  route: string;
  statusCode?: number;
}

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
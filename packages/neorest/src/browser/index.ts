// Export client-side functionality for browser
export { Client } from '../Client';
export { ClientConnection } from '../ClientConnection';
export { LiveSession } from '../LiveSession';
export type { LiveOptions, LiveSessionState } from '../LiveSession';

// Export transports for browser
export { WebSocketTransport } from '../transports/WebSocketTransport';
export { HttpTransport } from '../transports/HttpTransport';
export { AutoTransport } from '../transports/AutoTransport';
export { createTransport } from '../transports';

// Re-export core types (excluding server-side types)
export type {
  RouteResponse,
  Payload,
  RouteVerb,
  BroadcastEvent,
  ConnectionOptions,
  ReconnectOptions,
  MsgID,
  MsgType,
  MsgWrapper,
  ConnectionSecret,
  LiveIceServer,
} from '../core';

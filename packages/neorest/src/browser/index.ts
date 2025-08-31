// Export client-side functionality for browser
export { Client } from '../Client';
export { ClientConnection } from '../ClientConnection';

// Export strategies for browser
export { WebSocketStrategy } from '../strategies/WebSocketStrategy';
export { HttpStrategy } from '../strategies/HttpStrategy';
export { AutoStrategy } from '../strategies/AutoStrategy';
export { createStrategy } from '../strategies';

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
} from '../core';
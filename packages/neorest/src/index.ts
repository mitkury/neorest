// Export main client class
export { Client } from './Client';

// Export strategies for advanced usage
export { WebSocketStrategy } from './strategies/WebSocketStrategy';
export { HttpStrategy } from './strategies/HttpStrategy';
export { AutoStrategy } from './strategies/AutoStrategy';
export { createStrategy } from './strategies';

// Export connection class for advanced usage
export { ClientConnection } from './ClientConnection';

// Re-export types from core
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
} from './core';
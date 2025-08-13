// Export main client class (explicit .js extensions for ESM consumers)
export { Client } from './Client.js';

// Export strategies for advanced usage
export { WebSocketStrategy } from './strategies/WebSocketStrategy.js';
export { HttpStrategy } from './strategies/HttpStrategy.js';
export { AutoStrategy } from './strategies/AutoStrategy.js';
export { createStrategy } from './strategies/index.js';

// Export connection class for advanced usage
export { ClientConnection } from './ClientConnection.js';

// Re-export types from core
export type {
  RouteResponse,
  Payload,
  RouteVerb,
  BroadcastEvent,
  ConnectionOptions,
  ReconnectOptions,
} from '@neorest/core';
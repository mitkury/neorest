// Export main router class
export { Router } from './Router';
export type { RouterOptions, ServerAdapter } from './Router';

// Export server connection class
export { ServerConnection } from './ServerConnection';

// Export type definitions
export * from './types';

// Export transports
export { WebSocketTransport } from './transports/WebSocketTransport';
export { HttpTransportBase } from './transports/HttpTransportBase';
export { withAuth } from './middleware';

// Export utility functions
export {
  match,
  pathToRegexp,
  type Key,
  type MatchFunction,
  type Match,
  type MatchResult,
  type Path
} from './utils/pathToRegexp';

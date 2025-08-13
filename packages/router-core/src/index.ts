// Export main router class
export { Router } from './Router.js';
export type { RouterOptions, ServerAdapter } from './Router.js';

// Export server connection class
export { ServerConnection } from './ServerConnection.js';

// Export type definitions
export * from './types.js';

// Export strategies
export { WebSocketStrategy } from './strategies/WebSocketStrategy.js';
export { HttpStrategyBase } from './strategies/HttpStrategyBase.js';
export { withAuth } from './middleware.js';

// Export utility functions
export {
  match,
  pathToRegexp,
  type Key,
  type MatchFunction,
  type Match,
  type MatchResult,
  type Path
} from './utils/pathToRegexp.js';
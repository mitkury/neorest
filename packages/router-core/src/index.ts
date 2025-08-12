// Export main router class
export { Router } from './Router';
export type { RouterOptions, ServerAdapter } from './Router';

// Export server connection class
export { ServerConnection } from './ServerConnection';

// Export type definitions
export * from './types';

// Export strategies
export { WebSocketStrategy } from './strategies/WebSocketStrategy';
export { HttpStrategyBase } from './strategies/HttpStrategyBase';
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
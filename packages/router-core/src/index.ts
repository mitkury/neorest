// Export main router class
export { Router, RouterOptions, ServerAdapter } from './Router';

// Export server connection class
export { ServerConnection } from './ServerConnection';

// Export type definitions
export * from './types';

// Export strategies
export { WebSocketStrategy } from './strategies/WebSocketStrategy';
export { HttpStrategyBase } from './strategies/HttpStrategyBase';

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
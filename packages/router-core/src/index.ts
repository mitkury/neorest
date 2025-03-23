// Export main router class
export { RouterBase, RouterOptions } from './Router';

// Export server connection class
export { ServerConnection } from './ServerConnection';

// Export type definitions
export * from './types';

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
// Export types from the original core package
export * from './types';

// Export interfaces and types from CommunicationStrategy
export * from './CommunicationStrategy';

// Export base classes and their types
export { ConnectionBase } from './ConnectionBase';

// Export utilities
export * from './utils/TrackedPromise';
export * from './utils/connectionSecret';

// Export main router class
export { Router } from './Router';
export type { RouterOptions, ServerAdapter } from './Router';

// Export server connection class
export { ServerConnection } from './ServerConnection';

// Export router-specific types
export type { 
  RouteSubID,
  RouteListener,
  VerbAndHandler,
  RouteHandler,
  InRouteLayer,
  OutRouteLayer,
  RequestContext
} from './types';

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

// Re-export specific types that might be missing
export type { 
  MsgID, 
  MsgType, 
  MsgWrapper, 
  ConnectionSecret, 
  Payload,
  RouteVerb
} from './types';
// Export types
export * from './types';

// Export interfaces and types from CommunicationStrategy
export * from './CommunicationStrategy';

// Export base classes and their types
export * from './ConnectionBase';

// Export utilities
export * from './utils/TrackedPromise';
export * from './utils/connectionSecret';

// Re-export specific types that might be missing
export type { 
  MsgID, 
  MsgType, 
  MsgWrapper, 
  ConnectionSecret, 
  Payload
} from './types';
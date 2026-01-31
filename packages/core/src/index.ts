// Export types
export * from './types.js';

// Export interfaces and types from CommunicationTransport
export * from './CommunicationTransport.js';

// Export base classes and their types
export * from './ConnectionBase.js';

// Export utilities
export * from './utils/TrackedPromise.js';
export * from './utils/connectionSecret.js';

// Re-export specific types that might be missing
export type { 
  MsgID, 
  MsgType, 
  MsgWrapper, 
  ConnectionSecret, 
  Payload
} from './types.js';

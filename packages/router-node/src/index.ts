// Export main router class
export { NodeRouter } from './NodeRouter';
export type { NodeRouterOptions } from './NodeRouter';

// Export adapter
export { NodeServerAdapter } from './adapters/NodeServerAdapter';
export type { NodeServerAdapterOptions } from './adapters/NodeServerAdapter';

// Export strategies
export { HttpStrategy } from './strategies/HttpStrategy';
export { WebSocketStrategy } from './strategies/WebSocketStrategy';

// Re-export from router-core
export { ServerConnection, Router } from '@neorest/router-core';
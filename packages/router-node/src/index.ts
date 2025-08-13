// Export main router class (explicit .js extensions for Node ESM)
export { NodeRouter } from './NodeRouter.js';
export type { NodeRouterOptions } from './NodeRouter.js';

// Export adapter
export { NodeServerAdapter } from './adapters/NodeServerAdapter.js';
export type { NodeServerAdapterOptions } from './adapters/NodeServerAdapter.js';

// Export strategies
export { HttpStrategy } from './strategies/HttpStrategy.js';
export { WebSocketStrategy } from './strategies/WebSocketStrategy.js';

// Re-export from router-core
export { ServerConnection, Router } from '@neorest/router-core';
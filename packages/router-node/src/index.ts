// Export main router class
export { NodeRouter, NodeRouterOptions } from './NodeRouter';

// Export adapter
export { NodeServerAdapter, NodeServerAdapterOptions } from './adapters/NodeServerAdapter';

// Export strategies
export { HttpStrategy } from './strategies/HttpStrategy';

// Re-export from router-core
export { WebSocketStrategy, ServerConnection, Router } from '@neorest/router-core';
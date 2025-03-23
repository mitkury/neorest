import { CommunicationStrategy } from '@neorest/core';

// Detect Deno environment
const isDeno = typeof Deno !== 'undefined';

/**
 * Create a strategy based on the type and URL
 * @param type - The type of strategy to create
 * @param url - The URL to connect to
 * @returns The strategy
 */
export function createStrategy(type: 'websocket' | 'http', url: string): CommunicationStrategy {
  // Choose the appropriate implementation based on the environment
  if (isDeno) {
    // Deno environment
    switch (type) {
      case 'websocket': {
        // Dynamic import for Deno WebSocketStrategy
        const { WebSocketStrategy } = require('./deno/WebSocketStrategy');
        return new WebSocketStrategy(url);
      }
      case 'http': {
        // Dynamic import for Deno HttpStrategy (when implemented)
        // const { HttpStrategy } = require('./deno/HttpStrategy');
        // return new HttpStrategy(url);
        throw new Error('HTTP strategy for Deno is not implemented yet');
      }
      default:
        throw new Error(`Unsupported strategy type: ${type}`);
    }
  } else {
    // Browser or Node.js environment
    switch (type) {
      case 'websocket': {
        const { WebSocketStrategy } = require('./WebSocketStrategy');
        return new WebSocketStrategy(url);
      }
      case 'http': {
        const { HttpStrategy } = require('./HttpStrategy');
        return new HttpStrategy(url);
      }
      default:
        throw new Error(`Unsupported strategy type: ${type}`);
    }
  }
}
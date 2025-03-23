import { CommunicationStrategy } from '@neorest/core';
import { WebSocketStrategy } from './WebSocketStrategy';
import { HttpStrategy } from './HttpStrategy';

/**
 * Create a strategy based on the type and URL
 * @param type - The type of strategy to create
 * @param url - The URL to connect to
 * @returns The strategy
 */
export function createStrategy(type: 'websocket' | 'http', url: string): CommunicationStrategy {
  switch (type) {
    case 'websocket':
      return new WebSocketStrategy(url);
    case 'http':
      return new HttpStrategy(url);
    default:
      throw new Error(`Unsupported strategy type: ${type}`);
  }
}
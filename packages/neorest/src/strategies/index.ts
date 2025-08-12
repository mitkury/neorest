import { CommunicationStrategy } from '@neorest/core';
import { WebSocketStrategy } from './WebSocketStrategy';
import { HttpStrategy } from './HttpStrategy';
import { AutoStrategy } from './AutoStrategy';

/**
 * Create a strategy based on the type and URL
 * @param type - The type of strategy to create
 * @param url - The URL to connect to
 * @returns The strategy
 */
export function createStrategy(type: 'websocket' | 'http' | 'auto', url: string): CommunicationStrategy {
  switch (type) {
    case 'websocket':
      return new WebSocketStrategy(url);
    case 'http':
      return new HttpStrategy(url);
    case 'auto':
      return new AutoStrategy(url);
    default:
      throw new Error(`Unsupported strategy type: ${type}`);
  }
}
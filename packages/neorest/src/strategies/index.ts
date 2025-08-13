import { CommunicationStrategy } from '@neorest/core';
import { WebSocketStrategy } from './WebSocketStrategy';
import { HttpStrategy } from './HttpStrategy';
import { AutoStrategy } from './AutoStrategy';

/**
 * Create a strategy instance for the client
 */
export function createStrategy(type: 'websocket' | 'http' | 'auto', url: string): CommunicationStrategy {
  if (type === 'websocket') return new WebSocketStrategy(url);
  if (type === 'http') return new HttpStrategy(url);
  return new AutoStrategy(url);
}

export { WebSocketStrategy, HttpStrategy, AutoStrategy };
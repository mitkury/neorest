import { ClientTransport } from '../core';
import { WebSocketTransport } from './WebSocketTransport';
import { HttpTransport } from './HttpTransport';
import { AutoTransport } from './AutoTransport';

/**
 * Create a transport instance for the client
 */
export function createTransport(type: 'websocket' | 'http' | 'auto', url: string): ClientTransport {
  if (type === 'websocket') return new WebSocketTransport(url);
  if (type === 'http') return new HttpTransport(url);
  return new AutoTransport(url);
}

export { WebSocketTransport, HttpTransport, AutoTransport };

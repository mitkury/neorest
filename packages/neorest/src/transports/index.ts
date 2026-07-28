import { ClientTransport, ConnectionOptions, TransportMode } from '../core';
import { WebSocketTransport } from './WebSocketTransport';
import { HttpTransport } from './HttpTransport';
import { AutoTransport } from './AutoTransport';
import { WebTransportTransport } from './WebTransportTransport';

/**
 * Create a transport instance for the client
 */
export function createTransport(
  type: TransportMode,
  url: string,
  options?: ConnectionOptions,
): ClientTransport {
  if (type === 'websocket') return new WebSocketTransport(url);
  if (type === 'http') return new HttpTransport(url);
  if (type === 'webtransport') return new WebTransportTransport(url, options?.webTransport);
  return new AutoTransport(url, options);
}

export { WebSocketTransport, WebTransportTransport, HttpTransport, AutoTransport };

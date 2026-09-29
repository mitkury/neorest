import { describe, expect, it, vi } from 'vitest';
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';
import { portManager } from './utils/portManager';

interface WebSocketBackedClient {
  conn: { transport: { socket: WebSocket } };
}

describe('connection lifecycle', () => {
  it('reconnects the same client and preserves its subscriptions', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, connectionGracePeriodMs: 500 });
    server
      .onGet('/ping', (context) => {
        context.response = 'pong';
      })
      .onPost('/publish', (context) => {
        server.broadcastPost('/events', context.data);
        context.response = 'ok';
      });
    await server.start();

    const client = new Client(`ws://localhost:${port}`, 'websocket', {
      reconnect: {
        initialDelay: 20,
        maxDelay: 20,
        maxAttempts: 5,
      },
    });
    const connectionStates: boolean[] = [];
    const events: unknown[] = [];
    const removeConnectionListener = client.onConnectionChange((connected) => {
      connectionStates.push(connected);
    });

    try {
      await client.connect();
      await client.subscribe('/events', (event) => events.push(event.data));
      await client.post('/publish', { phase: 'before' });
      await vi.waitFor(() => expect(events).toEqual([{ phase: 'before' }]));

      (client as unknown as WebSocketBackedClient).conn.transport.socket.close();
      await vi.waitFor(() => expect(connectionStates).toContain(false));
      await vi.waitFor(() => expect(client.isConnected()).toBe(true));

      expect((await client.get('/ping')).data).toBe('pong');
      await client.post('/publish', { phase: 'after' });
      await vi.waitFor(() => {
        expect(events).toEqual([{ phase: 'before' }, { phase: 'after' }]);
      });
      expect(connectionStates.at(-1)).toBe(true);
    } finally {
      removeConnectionListener();
      client.close();
      await server.close();
    }
  });

  it('releases logical connection capacity after the reconnect grace period', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({
      port,
      connectionGracePeriodMs: 50,
      maxConnections: 1,
    });
    server.onGet('/ping', (context) => {
      context.response = 'pong';
    });
    await server.start();

    const first = new Client(`ws://localhost:${port}`, 'websocket', { reconnect: false });
    const replacement = new Client(`ws://localhost:${port}`, 'websocket', { reconnect: false });
    try {
      await first.connect();
      first.close();

      await new Promise((resolve) => setTimeout(resolve, 100));
      await replacement.connect();
      expect((await replacement.get('/ping')).data).toBe('pong');
    } finally {
      first.close();
      replacement.close();
      await server.close();
    }
  });
});

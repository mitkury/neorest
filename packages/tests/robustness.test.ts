import { describe, expect, it } from 'vitest';
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';
import { portManager } from './utils/portManager';

describe('robustness boundaries', () => {
  it('uses configured default headers and preserves them across auth changes', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, disableWebSocket: true });
    server.onGet('/headers', (ctx) => {
      ctx.response = ctx.headers;
    });
    await server.start();

    const client = new Client(`http://localhost:${port}`, 'http', {
      headers: { 'x-client-name': 'sila2' },
    });
    try {
      await client.connect();
      client.setAuthToken('test-token');

      const authenticated = await client.get<Record<string, string>>('/headers');
      expect(authenticated.data['x-client-name']).toBe('sila2');
      expect(authenticated.data.Authorization).toBe('Bearer test-token');

      client.clearAuthToken();
      const cleared = await client.get<Record<string, string>>('/headers');
      expect(cleared.data['x-client-name']).toBe('sila2');
      expect(cleared.data.Authorization).toBeUndefined();
    } finally {
      client.close();
      await server.close();
    }
  });

  it('resolves requests with a timeout response instead of leaving them pending', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, disableWebSocket: true });
    server.onGet('/slow', async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      ctx.response = 'late';
    });
    await server.start();

    const client = new Client(`http://localhost:${port}`, 'http', {
      timeout: 50,
      reconnect: false,
    });
    try {
      await client.connect();
      const response = await client.get('/slow');
      expect(response.status).toBe(408);
      expect(response.error).toContain('timed out');
    } finally {
      client.close();
      await server.close();
    }
  });

  it('does not send a queued write after that request has timed out', async () => {
    const port = await portManager.getNextPort();
    const client = new Client(`http://localhost:${port}`, 'http', {
      timeout: 50,
      reconnect: false,
    });

    const timedOut = await client.post('/write', { value: 1 });
    expect(timedOut.status).toBe(408);

    let writes = 0;
    const server = new NodeRouter({ port, disableWebSocket: true });
    server.onPost('/write', (ctx) => {
      writes++;
      ctx.response = { ok: true };
    });
    await server.start();
    try {
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(writes).toBe(0);
    } finally {
      client.close();
      await server.close();
    }
  });

  it('turns route handler failures into stable 500 responses', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, disableWebSocket: true });
    server.onGet('/throws', async () => {
      throw new Error('sensitive implementation detail');
    });
    await server.start();

    const client = new Client(`http://localhost:${port}`, 'http');
    try {
      await client.connect();
      const protocolResponse = await client.get('/throws');
      expect(protocolResponse.status).toBe(500);
      expect(protocolResponse.error).toBe('Internal server error');

      const httpResponse = await fetch(`http://localhost:${port}/throws`);
      expect(httpResponse.status).toBe(500);
      expect(await httpResponse.json()).toEqual({ error: 'Internal server error' });
    } finally {
      client.close();
      await server.close();
    }
  });

  it('unsubscribes one parameter value without removing sibling subscriptions', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, disableWebSocket: true });
    server.onValidateBroadcast('/topic/:name', () => true);
    await server.start();

    const client = new Client(`http://localhost:${port}`, 'http');
    const alpha: unknown[] = [];
    const beta: unknown[] = [];
    try {
      await client.connect();
      await client.subscribe('/topic/alpha', (event) => alpha.push(event.data));
      await client.subscribe('/topic/beta', (event) => beta.push(event.data));

      client.unsubscribe('/topic/alpha');
      await new Promise((resolve) => setTimeout(resolve, 100));
      server.broadcastPost('/topic/alpha', 'alpha');
      server.broadcastPost('/topic/beta', 'beta');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(alpha).toEqual([]);
      expect(beta).toEqual(['beta']);
    } finally {
      client.close();
      await server.close();
    }
  });

  it('rejects oversized request bodies and remains available', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({
      port,
      disableWebSocket: true,
      maxRequestBodyBytes: 32,
    });
    server
      .onPost('/echo', (ctx) => {
        ctx.response = ctx.data;
      })
      .onGet('/health', (ctx) => {
        ctx.response = { ok: true };
      });
    await server.start();

    try {
      const oversized = await fetch(`http://localhost:${port}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x'.repeat(100) }),
      });
      expect(oversized.status).toBe(413);

      const health = await fetch(`http://localhost:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  it('rejects invalid transport methods and message envelopes', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, disableWebSocket: true });
    await server.start();

    try {
      const invalidHandshake = await fetch(`http://localhost:${port}/.neorest`, {
        method: 'POST',
      });
      expect(invalidHandshake.status).toBe(405);

      const handshake = await fetch(`http://localhost:${port}/.neorest`);
      const { clientId } = await handshake.json() as { clientId: string };
      const malformed = await fetch(
        `http://localhost:${port}/.neorest?clientId=${encodeURIComponent(clientId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 0, msg: {} }),
        },
      );
      expect(malformed.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('rejects an HTTP connection when the handshake cannot reach a server', async () => {
    const port = await portManager.getNextPort();
    const client = new Client(`http://localhost:${port}`, 'http', {
      reconnect: false,
    });
    await expect(client.connect()).rejects.toThrow();
    expect(client.isConnected()).toBe(false);
    client.close();
  });

  it('exposes connection state changes for snapshot refresh logic', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port, disableWebSocket: true });
    await server.start();

    const client = new Client(`http://localhost:${port}`, 'http', {
      reconnect: false,
    });
    const states: boolean[] = [];
    const removeListener = client.onConnectionChange((connected) => {
      states.push(connected);
    });
    try {
      await client.connect();
      client.close();
      expect(states).toEqual([true, false]);
      removeListener();
    } finally {
      client.close();
      await server.close();
    }
  });

  it('restores HTTP after an upgraded WebSocket transport drops', async () => {
    const port = await portManager.getNextPort();
    const server = new NodeRouter({ port });
    server.onGet('/ping', (ctx) => {
      ctx.response = 'pong';
    });
    await server.start();

    const client = new Client(`http://localhost:${port}`, 'auto', {
      timeout: 2000,
    });
    try {
      await client.connect();
      expect((await client.get('/ping')).data).toBe('pong');

      const autoTransport = (client as any).conn.transport;
      const waitForTransport = async (type: 'websocket' | 'http') => {
        const deadline = Date.now() + 2000;
        while (autoTransport.getConnectionInfo().type !== type && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(autoTransport.getConnectionInfo().type).toBe(type);
      };

      await waitForTransport('websocket');
      expect((client as any).conn.getTransportType()).toBe('auto');
      autoTransport.ws.socket.close();
      await waitForTransport('http');
      expect((client as any).conn.getTransportType()).toBe('auto');

      const response = await client.get('/ping');
      expect(response.error).toBeUndefined();
      expect(response.data).toBe('pong');
    } finally {
      client.close();
      await server.close();
    }
  });
});

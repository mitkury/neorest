import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { portManager } from './utils/portManager';

async function startServer(port?: number, received: any[] = []) {
  const serverPort = port || await portManager.getNextPort();
  const router = new NodeRouter({ port: serverPort });

  router
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; })
    .onPost('/send', async (ctx) => {
      received.push(ctx.data);
      ctx.response = 'ok';
      // broadcast back to subscribers so clients receive events
      router.broadcastPost('/topic/news', { from: 'server', payload: ctx.data });
    });

  // Allow clients to subscribe to a topic route
  router.onValidateBroadcast('/topic/:name', () => true);

  await router.listen();
  return { router, port: serverPort };
}

describe('neorest client ↔ node server (websocket)', () => {
  it('handles GET /ping and POST /echo over WebSocket and multi-message flow', async () => {
    const receivedOnServer: any[] = [];
    const { router: server, port } = await startServer(undefined, receivedOnServer);
    let client: Client | null = null;

    try {
      client = new Client(`ws://localhost:${port}`, 'websocket');
      await client.connect();

      // Basic request/response
      const pong = await client.get('/ping');
      expect(pong.data).toBe('pong');

      const payload = { hello: 'ws' };
      const echo = await client.post<typeof payload>('/echo', payload);
      expect(echo.data.hello).toBe('ws');

      // Subscribe and perform back-and-forth flow
      const broadcasts: any[] = [];
      await client.on('/topic/news', (evt) => {
        broadcasts.push(evt.data);
      });

      // Send multiple messages and expect server to receive and broadcast
      const msgs = [{ n: 1 }, { n: 2 }];
      for (const m of msgs) {
        const res = await client.post('/send', m);
        expect(res.error).toBeUndefined();
      }

      // Wait until both broadcasts are received or timeout
      const waitUntil = async (cond: () => boolean, timeoutMs = 5000) => {
        const start = Date.now();
        while (!cond()) {
          if (Date.now() - start > timeoutMs) break;
          await new Promise((r) => setTimeout(r, 25));
        }
      };

      await waitUntil(() => broadcasts.length >= 2);

      // Assert server saw both messages
      expect(receivedOnServer).toEqual([{ n: 1 }, { n: 2 }]);

      // Assert client received both broadcasts in order
      expect(broadcasts.length).toBe(2);
      expect(broadcasts[0]).toEqual({ from: 'server', payload: { n: 1 } });
      expect(broadcasts[1]).toEqual({ from: 'server', payload: { n: 2 } });
    } finally {
      try { (client as any)?.close?.(); } catch {}
      await (server as any).close();
    }
  });
});
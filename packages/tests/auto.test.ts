import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';

async function startServer(port = 8101, received: any[] = []) {
  const router = new NodeRouter({ port });

  router
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; })
    .onPost('/send', async (ctx) => {
      received.push(ctx.data);
      ctx.response = 'ok';
      router.broadcastPost('/topic/news', { from: 'server', payload: ctx.data });
    });

  router.onValidateBroadcast('/topic/:name', () => true);

  await router.listen();
  return router;
}

describe('neorest client ↔ node server (auto strategy: http first, ws upgrade)', () => {
  it('performs GET/POST over initial HTTP and receives broadcasts (upgrade if WS available)', async () => {
    const port = 8101;
    const receivedOnServer: any[] = [];
    const server = await startServer(port, receivedOnServer);
    let client: Client | null = null;

    try {
      client = new Client(`http://localhost:${port}`, 'auto');
      await (client as any).conn.connect();

      // Initial request/response (should work over HTTP immediately)
      const pong = await client.get('/ping');
      expect(pong.data).toBe('pong');

      const payload = { hello: 'auto' };
      const echo = await client.post<typeof payload>('/echo', payload);
      expect(echo.data.hello).toBe('auto');

      // Subscribe and verify broadcasts arrive (via WS if upgraded, otherwise via HTTP long-poll)
      const broadcasts: any[] = [];
      await client.on('/topic/news', (evt) => {
        broadcasts.push(evt.data);
      });

      const msgs = [{ n: 1 }, { n: 2 }];
      for (const m of msgs) {
        const res = await client.post('/send', m);
        expect(res.error).toBeUndefined();
      }

      // Wait until broadcasts received (HTTP long-poll may take up to ~1s)
      const waitUntil = async (cond: () => boolean, timeoutMs = 3000) => {
        const start = Date.now();
        while (!cond()) {
          if (Date.now() - start > timeoutMs) break;
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      await waitUntil(() => broadcasts.length >= 2);

      expect(receivedOnServer).toEqual([{ n: 1 }, { n: 2 }]);
      expect(broadcasts.length).toBe(2);
      expect(broadcasts[0]).toEqual({ from: 'server', payload: { n: 1 } });
      expect(broadcasts[1]).toEqual({ from: 'server', payload: { n: 2 } });
    } finally {
      try { (client as any)?.close?.(); } catch {}
      await (server as any).close();
    }
  });
});
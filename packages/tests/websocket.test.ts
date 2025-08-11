import { describe, it, expect } from 'vitest';
import { Router } from '@neorest/router-core';
import { NodeServerAdapter } from '@neorest/router-node';
import { Client } from 'neorest';

async function startServer(port = 8100) {
  const router = new Router();
  const adapter = new NodeServerAdapter({ port });
  router.setServerAdapter(adapter);

  router
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });

  await router.listen();
  return router;
}

describe('neorest client ↔ node server (websocket)', () => {
  it('handles GET /ping and POST /echo over WebSocket', async () => {
    const port = 8100;
    const server = await startServer(port);
    let client: Client | null = null;

    try {
      client = new Client(`ws://localhost:${port}`, 'websocket');
      await (client as any).conn.connect();

      const pong = await client.get('/ping');
      expect(pong.data).toBe('pong');

      const payload = { hello: 'ws' };
      const echo = await client.post<typeof payload>('/echo', payload);
      expect(echo.data.hello).toBe('ws');
    } finally {
      try { (client as any)?.close?.(); } catch {}
      await (server as any).close();
    }
  });
});
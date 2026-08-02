import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { portManager } from './utils/portManager';

async function startServer(port: number) {
  const router = new NodeRouter({ port });

  router
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });

  await router.listen();
  return router;
}

describe('neorest client ↔ node server (http)', () => {
  it('handles GET /ping and POST /echo', async () => {
    const port = await portManager.getNextPort();
    const server = await startServer(port);
    let client: Client | null = null;

    try {
      client = new Client(`http://localhost:${port}`, 'http');
      expect(client.getURL()).toBe(`http://localhost:${port}`);
      await client.connect();

      const pong = await client.get('/ping');
      expect(pong.data).toBe('pong');

      const payload = { hello: 'world' };
      const echo = await client.post<typeof payload>('/echo', payload);
      expect(echo.data.hello).toBe('world');
    } finally {
      client?.close();
      await server.close();
    }
  });
});

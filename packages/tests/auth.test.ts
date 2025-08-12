import { describe, it, expect } from 'vitest';
import { NodeRouter } from '@neorest/router-node';
import { withAuth } from '@neorest/router-core';
import { Client } from 'neorest';

async function startServer(port = 8103) {
  const router = new NodeRouter({ port, disableWebSocket: true });

  // Mock token store
  let currentToken = 'valid-token-123';
  let tokenValid = true;

  router
    .onGet('/token', async (ctx) => { ctx.response = { token: currentToken }; })
    .onPost('/invalidate', async (ctx) => { tokenValid = false; ctx.response = 'ok'; })
    .onGet('/private/info', withAuth(async (token) => tokenValid && token === currentToken, async (ctx) => {
      ctx.response = { topSecret: true };
    }));

  await router.listen();
  return router;
}

describe('auth middleware: bearer token success and invalidation', () => {
  it('issues a token, allows access with token, then denies after invalidation', async () => {
    const port = 8103;
    const server = await startServer(port);
    let client: Client | null = null;

    try {
      client = new Client(`http://localhost:${port}`, 'http');
      await (client as any).conn.connect();

      const tokenRes = await client.get<{ token: string }>('/token');
      const token = tokenRes.data.token;
      expect(typeof token).toBe('string');

      client.setAuthToken(token);

      const info = await client.get<{ topSecret: boolean }>('/private/info');
      expect(info.error).toBeUndefined();
      expect(info.data.topSecret).toBe(true);

      await client.post('/invalidate');

      const denied = await client.get('/private/info');
      expect(denied.error).toBe('Unauthorized');
    } finally {
      try { (client as any)?.close?.(); } catch {}
      await (server as any).close();
    }
  });
});
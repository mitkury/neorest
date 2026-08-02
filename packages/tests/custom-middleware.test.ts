import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import type { RequestContext } from 'neorest/core';
import { portManager } from './utils/portManager';

async function startServer(port: number) {
  const router = new NodeRouter({ port, disableWebSocket: true });

  type Handler = (ctx: RequestContext) => void | Promise<void>;

  function withRequiredHeader(headerName: string, handler: Handler): Handler {
    return async (ctx) => {
      if (!ctx.headers?.[headerName]) {
        ctx.statusCode = 400;
        ctx.error = `Missing header: ${headerName}`;
        return;
      }
      await handler(ctx);
    };
  }

  router.onPost(
    '/mw/test',
    withRequiredHeader('x-request-id', async (ctx) => {
      ctx.statusCode = 201;
      ctx.response = { ok: true, echoed: ctx.data };
    })
  );

  await router.listen();
  return router;
}

describe('custom middleware inline in test file', () => {
  it('rejects when header missing and succeeds when present', async () => {
    const port = await portManager.getNextPort();
    const server = await startServer(port);
    let client: Client | null = null;

    try {
      client = new Client(`http://localhost:${port}`, 'http');
      await client.connect();

      // Missing header should be rejected with 400
      const bad = await client.post('/mw/test', { a: 1 });
      expect(bad.error).toBe('Missing header: x-request-id');
      expect(bad.status).toBe(400);

      // With header should succeed and return 201
      const good = await client.post<{ ok: boolean; echoed: { a: number } }>(
        '/mw/test',
        { a: 2 },
        { 'x-request-id': 'req-123' }
      );
      expect(good.error).toBeUndefined();
      expect(good.status).toBe(201);
      expect(good.data.ok).toBe(true);
      expect(good.data.echoed).toEqual({ a: 2 });
    } finally {
      client?.close();
      await server.close();
    }
  });
});

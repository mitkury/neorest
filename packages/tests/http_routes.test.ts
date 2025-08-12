import { describe, it, expect } from 'vitest';
import { NodeRouter } from '@neorest/router-node';

async function startServer(port = 8200) {
  const router = new NodeRouter({ port });
  router
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; })
    .onDelete('/items/:id', async (ctx) => { ctx.response = { deleted: ctx.params.id }; });

  await router.listen();
  return router;
}

describe('plain HTTP routes', () => {
  it('serves GET/POST/DELETE over regular HTTP with JSON', async () => {
    const port = 8200;
    const server = await startServer(port);
    try {
      // GET /ping
      const r1 = await fetch(`http://localhost:${port}/ping`);
      expect(r1.status).toBe(200);
      const t1 = await r1.text();
      // Allow string JSON ("pong")
      expect(t1).toBe(JSON.stringify('pong'));

      // POST /echo
      const payload = { hello: 'http' };
      const r2 = await fetch(`http://localhost:${port}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(r2.status).toBe(200);
      const j2 = await r2.json();
      expect(j2).toEqual(payload);

      // DELETE /items/:id
      const r3 = await fetch(`http://localhost:${port}/items/42`, { method: 'DELETE' });
      expect(r3.status).toBe(200);
      const j3 = await r3.json();
      expect(j3).toEqual({ deleted: '42' });

      // Transport: handshake under /.neorest returns clientId
      const r4 = await fetch(`http://localhost:${port}/.neorest`);
      expect(r4.status).toBe(200);
      const j4 = await r4.json();
      expect(j4.clientId).toBeDefined();
    } finally {
      await (server as any).close();
    }
  });
});
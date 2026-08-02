import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { portManager } from './utils/portManager';

async function startServer(port: number, register: (router: NodeRouter) => void) {
  const router = new NodeRouter({ port });
  register(router);
  await router.listen();
  return router;
}

describe('path conflict resolution (static vs parameterized)', () => {
  it('prefers static over parameterized when both match (param registered first)', async () => {
    const port = await portManager.getNextPort();
    const server = await startServer(port, (router) => {
      router
        .onGet('/users/:id', async (ctx) => { ctx.response = `param:${ctx.params.id}`; })
        .onGet('/users/new', async (ctx) => { ctx.response = 'static'; });
    });

    let client: Client | null = null;
    try {
      client = new Client(`http://localhost:${port}`, 'http');
      await client.connect();

      const res1 = await client.get('/users/new');
      expect(res1.data).toBe('static');

      const res2 = await client.get('/users/123');
      expect(res2.data).toBe('param:123');
    } finally {
      client?.close();
      await server.close();
    }
  });

  it('prefers static over parameterized when both match (static registered first)', async () => {
    const port = await portManager.getNextPort();
    const server = await startServer(port, (router) => {
      router
        .onGet('/users/new', async (ctx) => { ctx.response = 'static'; })
        .onGet('/users/:id', async (ctx) => { ctx.response = `param:${ctx.params.id}`; });
    });

    let client: Client | null = null;
    try {
      client = new Client(`http://localhost:${port}`, 'http');
      await client.connect();

      const res1 = await client.get('/users/new');
      expect(res1.data).toBe('static');

      const res2 = await client.get('/users/999');
      expect(res2.data).toBe('param:999');
    } finally {
      client?.close();
      await server.close();
    }
  });

  it('avoids duplicate broadcast subscriptions when static and param out routes both exist', async () => {
    const port = await portManager.getNextPort();
    const server = await startServer(port, (router) => {
      router
        .onPost('/send', async (ctx) => {
          ctx.response = 'ok';
          router.broadcastPost('/topic/news', { hello: 'world' });
        });

      router.onValidateBroadcast('/topic/:name', () => true);
      router.onValidateBroadcast('/topic/news', () => true);
    });

    let client: Client | null = null;
    try {
      client = new Client(`http://localhost:${port}`, 'auto');
      await client.connect();

      const received: any[] = [];
      await client.on('/topic/news', (evt) => {
        received.push(evt.data);
      });

      // Trigger two broadcasts
      await client.post('/send', {});
      await client.post('/send', {});

      // Wait for up to ~2s for 2 messages
      const waitUntil = async (cond: () => boolean, timeoutMs = 2000) => {
        const start = Date.now();
        while (!cond()) {
          if (Date.now() - start > timeoutMs) break;
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      await waitUntil(() => received.length >= 2);

      expect(received.length).toBe(2);
      expect(received[0]).toEqual({ hello: 'world' });
      expect(received[1]).toEqual({ hello: 'world' });
    } finally {
      client?.close();
      await server.close();
    }
  });
});

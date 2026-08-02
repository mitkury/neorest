import { describe, it, expect, vi } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { msg_ConnDataSet } from 'neorest/core';
import { portManager } from './utils/portManager';

async function makeServer(port?: number) {
  const serverPort = port || await portManager.getNextPort();
  const router = new NodeRouter({ port: serverPort });

  router
    .onPost('/send/:topic', async (ctx) => {
      router.broadcastPost(`/secure/${ctx.params.topic}`, { ok: true, topic: ctx.params.topic });
      ctx.response = { ok: true };
    })
    .onValidateBroadcast('/secure/:topic', (conn) => {
      return conn.getHeader('auth') === 'good';
    });

  await router.listen();
  return { router, port: serverPort };
}

describe('per-subscriber authorization with connection-scoped token', () => {
  it('delivers only to subscribers whose connection has the required token', async () => {
    const { router, port } = await makeServer();
    const a = new Client(`ws://localhost:${port}`, 'websocket');
    const b = new Client(`ws://localhost:${port}`, 'websocket');
    try {
      await a.connect();
      await b.connect();

      const setA = await new Promise<{ status?: number }>((resolve) => {
        const connection = (a as unknown as {
          conn: { post(message: unknown, callback: (response: { status?: number }) => void): void };
        }).conn;
        connection.post(msg_ConnDataSet('auth', 'good'), resolve);
      });
      expect(setA.status ?? 200).toBe(200);

      const recvA: unknown[] = [];
      const recvB: unknown[] = [];
      await a.subscribe('/secure/news', (event) => recvA.push(event.data));
      await b.subscribe('/secure/news', (event) => recvB.push(event.data));

      expect((await a.post('/send/news', { x: 1 })).error).toBeUndefined();
      await vi.waitFor(() => {
        expect(recvA).toEqual([{ ok: true, topic: 'news' }]);
      });
      expect(recvB).toEqual([]);
    } finally {
      a.close();
      b.close();
      await router.close();
    }
  });
});

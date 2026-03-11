import { describe, it, expect } from 'vitest';
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
      return (conn as any).getHeader('auth') === 'good';
    });

  await router.listen();
  return { router, port: serverPort };
}

describe('per-subscriber authorization with connection-scoped token', () => {
  it('delivers only to subscribers whose connection has the required token', async () => {
    const { router, port } = await makeServer();
    const a = new Client(`ws://localhost:${port}`, 'websocket');
    const b = new Client(`ws://localhost:${port}`, 'websocket');
    await a.connect();
    await b.connect();

    // Set connection-scoped token for client A only
    const setA: any = await new Promise((resolve) => {
      ((a as any).conn).post(msg_ConnDataSet('auth', 'good'), (r: any) => resolve(r));
    });
    expect(setA.status || 200).toBe(200);

    const recvA: any[] = [];
    const recvB: any[] = [];
    await a.on('/secure/news', (evt) => recvA.push(evt.data));
    await b.on('/secure/news', (evt) => recvB.push(evt.data));

    const res = await a.post('/send/news', { x: 1 });
    expect(res.error).toBeUndefined();

    const start = Date.now();
    while (recvA.length < 1 && Date.now() - start < 1500) {
      await new Promise(r => setTimeout(r, 20));
    }

    // A should receive, B should not
    expect(recvA.length).toBe(1);
    expect(recvA[0]).toEqual({ ok: true, topic: 'news' });
    expect(recvB.length).toBe(0);

    (a as any).close?.();
    (b as any).close?.();
    await (router as any).close();
  });
});


import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { portManager } from './utils/portManager';

async function makeServer(withExplicitValidator: boolean, allow: boolean, port?: number) {
  const serverPort = port || await portManager.getNextPort();
  const router = new NodeRouter({ port: serverPort });

  router
    .onPost('/send/:topic', async (ctx) => {
      router.broadcastPost(`/topic/${ctx.params.topic}`, { ok: true, topic: ctx.params.topic });
      ctx.response = { ok: true };
    });

  if (withExplicitValidator) {
    router.onValidateBroadcast('/topic/:topic', () => allow);
  }

  await router.listen();
  return { router, port: serverPort };
}

describe('broadcast wildcard default', () => {
  it('delivers without explicit onValidate (default wildcard allows)', async () => {
    const { router, port } = await makeServer(false, true);
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    await (client as any).conn.connect();

    const received: any[] = [];
    await client.on('/topic/news', (evt) => received.push(evt.data));

    const res = await client.post('/send/news', { msg: 1 });
    expect(res.error).toBeUndefined();

    const start = Date.now();
    while (received.length < 1 && Date.now() - start < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ ok: true, topic: 'news' });

    (client as any).close?.();
    await (router as any).close();
  });

  it('respects explicit validator that denies', async () => {
    const { router, port } = await makeServer(true, false);
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    await (client as any).conn.connect();

    const received: any[] = [];
    await client.on('/topic/news', (evt) => received.push(evt.data));

    const res = await client.post('/send/news', { msg: 1 });
    expect(res.error).toBeUndefined();

    await new Promise(r => setTimeout(r, 300));
    expect(received.length).toBe(0);

    (client as any).close?.();
    await (router as any).close();
  });

  it('respects explicit validator that allows', async () => {
    const { router, port } = await makeServer(true, true);
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    await (client as any).conn.connect();

    const received: any[] = [];
    await client.on('/topic/news', (evt) => received.push(evt.data));

    const res = await client.post('/send/news', { msg: 1 });
    expect(res.error).toBeUndefined();

    const start = Date.now();
    while (received.length < 1 && Date.now() - start < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ ok: true, topic: 'news' });

    (client as any).close?.();
    await (router as any).close();
  });
});


import { describe, expect, it, vi } from 'vitest';
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';
import { portManager } from './utils/portManager';

async function makeServer(validate?: () => boolean): Promise<{
  router: NodeRouter;
  port: number;
}> {
  const port = await portManager.getNextPort();
  const router = new NodeRouter({ port });
  router.onPost('/send/:topic', (context) => {
    router.broadcastPost(`/topic/${context.params.topic}`, {
      topic: context.params.topic,
    });
    context.response = { ok: true };
  });
  if (validate) router.onValidateBroadcast('/topic/:topic', validate);
  await router.start();
  return { router, port };
}

describe('broadcast validation', () => {
  it('delivers broadcasts through the default wildcard policy', async () => {
    const { router, port } = await makeServer();
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    const received: unknown[] = [];
    try {
      await client.connect();
      await client.subscribe('/topic/news', (event) => received.push(event.data));
      await client.post('/send/news');

      await vi.waitFor(() => expect(received).toEqual([{ topic: 'news' }]));
    } finally {
      client.close();
      await router.close();
    }
  });

  it('does not deliver a broadcast rejected by an explicit validator', async () => {
    const { router, port } = await makeServer(() => false);
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    const received: unknown[] = [];
    try {
      await client.connect();
      await client.subscribe('/topic/news', (event) => received.push(event.data));
      await client.post('/send/news');

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received).toEqual([]);
    } finally {
      client.close();
      await router.close();
    }
  });
});

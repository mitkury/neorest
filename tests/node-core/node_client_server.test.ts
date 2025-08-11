import { Router } from '../../packages/router-core/src/index.ts';
import { NodeServerAdapter } from '../../packages/router-node/src/index.ts';
import { Client } from '../../packages/neorest/src/index.ts';

async function startServer(port = 8099) {
  const router = new Router();
  const adapter = new NodeServerAdapter({ port });
  router.setServerAdapter(adapter);

  router
    .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
    .onPost('/echo', async (ctx) => { ctx.response = ctx.data; });

  await router.listen();
  return router;
}

async function run() {
  const port = 8099;
  const server = await startServer(port);
  try {
    const client = new Client(`http://localhost:${port}`, 'http');
    await (client as any).conn.connect();

    const pong = await client.get('/ping');
    if (pong.data !== 'pong') throw new Error('GET /ping failed');

    const payload = { hello: 'world' };
    const echo = await client.post<typeof payload>('/echo', payload);
    if (echo.data.hello !== 'world') throw new Error('POST /echo failed');

    console.log('OK: node client/server basic routes work');
  } finally {
    await (server as any).close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });



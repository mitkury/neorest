import { Router } from '../../packages/router-core/dist/index.js';
import { NodeServerAdapter } from '../../packages/router-node/dist/index.js';
import { Client } from '../../packages/neorest/dist/index.js';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    await client['conn'].connect();

    const pong = await client.get('/ping');
    if (pong.data !== 'pong') throw new Error('GET /ping failed');

    const payload = { hello: 'world' };
    const echo = await client.post('/echo', payload);
    if (echo.data.hello !== 'world') throw new Error('POST /echo failed');

    console.log('OK: node client/server basic routes work');
  } finally {
    await server.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });



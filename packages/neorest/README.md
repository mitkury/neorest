# neorest

REST-style routes with real-time subscriptions.

## Install

```bash
npm install neorest
```

## Server

```ts
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ port: 8080 });

router
  .onGet('/ping', (ctx) => {
    ctx.response = 'pong';
  })
  .onPost('/messages', (ctx) => {
    ctx.response = ctx.data;
    router.broadcast('/messages', { action: 'POST', data: ctx.data }, ctx.sender);
  });

await router.start();
```

## Client

```ts
import { Client } from 'neorest';

const client = new Client('http://localhost:8080', 'auto');
await client.connect();

const pong = await client.get<string>('/ping');

await client.subscribe('/messages', (event) => {
  console.log(event.data);
});

await client.post('/messages', { text: 'hello' });
```

## API

- `new Client(url, transport?, options?)`
- `client.connect()`
- `client.get(route, headers?)`
- `client.post(route, payload?, headers?)`
- `client.delete(route, headers?)`
- `client.subscribe(route, callback)` or `client.on(route, callback)`
- `client.unsubscribe(route)` or `client.off(route)`

- `new NodeRouter(options?)`
- `router.onGet(route, handler)`
- `router.onPost(route, handler)`
- `router.onDelete(route, handler)`
- `router.broadcast(route, event, exceptConn?)`
- `router.start()` or `router.listen()`
- `router.close()`

## Notes

- `neorest/node` is the Node.js server entrypoint.
- Registered routes are also exposed over plain HTTP unless `disableHttpRoutes` is set.
- Transport endpoints live under `/.neorest`.

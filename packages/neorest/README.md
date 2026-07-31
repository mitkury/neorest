# neorest

REST-style routes with real-time subscriptions.

## Install

```bash
npm install neorest
```

The Node server runtime requires Node.js 20 or newer. Production WebTransport
support additionally requires its optional HTTP/3 provider:

```bash
npm install @fails-components/webtransport \
  @fails-components/webtransport-transport-http3-quiche
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
- `router.onAuthorizeSubscription(route, authorize)`
- `router.onValidateBroadcast(route, validate)`
- `router.createHandlers()` for an existing Node/SvelteKit TCP server
- `router.start()` or `router.listen()`
- `router.close()`

## Notes

- `neorest/node` is the Node.js server entrypoint.
- Auto mode prefers advertised WebTransport, then WebSocket, then held HTTP.
- Enable the HTTP/3/UDP listener with
  `webTransport: { port, hostname, publicUrl, cert, privateKey }`.
- WebTransport inherits cookie authentication through a short-lived,
  single-use ticket issued by the ordinary HTTP handshake.
- Registered routes are also exposed over plain HTTP unless `disableHttpRoutes` is set.
- Transport endpoints live under `/.neorest`.
- `authenticateConnection` receives standards-compatible request `Headers`,
  suitable for Better Auth cookie-session lookup, and can return an immutable
  `{ id, ...context }` identity.
- CORS, body size, held long-poll timeout, pending handshakes, HTTP request
  rate, protocol message rate, and logical connection count are configurable.
- Requests already handed to a transport are not automatically replayed after
  disconnect. Use application-level idempotency keys for retryable writes.

Deployment details are documented in the
[WebTransport guide](https://github.com/mitkury/neorest/blob/main/docs/webtransport.md),
and connection guarantees are described in the
[connection model](https://github.com/mitkury/neorest/blob/main/docs/connections.md).

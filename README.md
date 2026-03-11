# Neorest

Real-time routes on top of a REST-shaped API.

Neorest lets you keep one route model for request/response and live updates:

- `GET`, `POST`, `DELETE` on routes
- subscribe to the same routes for broadcasts
- WebSocket when available, HTTP long-polling fallback when not
- plain HTTP access to registered server routes

## Install

```bash
npm install neorest
```

## Node.js server

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
  console.log(event.action, event.data);
});

await client.post('/messages', { text: 'hello' });
```

## Plain HTTP routes

Registered routes are also available over regular HTTP by default:

```bash
curl http://localhost:8080/ping
curl -X POST http://localhost:8080/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello"}'
```

Neorest transport endpoints live under `/.neorest`:

- `GET /.neorest` for handshake
- `GET /.neorest?poll=true&clientId=...` for polling
- `POST /.neorest?clientId=...` for sending protocol messages

Set `disableHttpRoutes: true` on `NodeRouter` to expose only the transport endpoints.

## Workspace layout

- `packages/neorest`: published package
- `packages/tests`: Vitest coverage for HTTP, WebSocket, reconnect, auth, and route matching
- `packages/benchmark`: ad hoc benchmark scripts
- `packages/playground`: small demo apps

## Development

```bash
npm test
```

That builds `neorest` and runs the unit tests.

For a short explanation of how Neorest connections, transport upgrades, and reconnects work, see [docs/connections.md](/Users/dk/repos/neorest/docs/connections.md).

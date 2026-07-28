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

Client options support default request headers, request timeouts, and reconnect
policy:

```ts
const client = new Client('http://localhost:8080', 'auto', {
  timeout: 15_000,
  headers: { 'x-client-name': 'web' },
  reconnect: { maxAttempts: 10 },
});

client.onConnectionChange((connected) => {
  if (connected) {
    // Refetch durable snapshots after a restored connection.
  }
});
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
Set `maxRequestBodyBytes` to change the default 1 MiB JSON/WebSocket payload
limit.

## Existing Node or SvelteKit server

`createHandlers()` lets a host server compose Neorest without opening another
port:

```ts
import { createServer } from 'node:http';
import { handler as svelteKitHandler } from './build/handler.js';
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ disableHttpRoutes: true });
const neorest = await router.createHandlers();

const server = createServer(async (req, res) => {
  if (await neorest.request(req, res)) return;
  svelteKitHandler(req, res);
});

server.on('upgrade', (req, socket, head) => {
  void neorest.upgrade(req, socket, head).then((handled) => {
    if (!handled) socket.destroy();
  });
});

server.listen(8080);
```

The host owns `server.listen()` and `server.close()`. Call `router.close()` to
release Neorest connections and timers.

## Cookie sessions and subscriptions

Authenticate the native handshake once and bind a trusted, immutable identity
to the connection:

```ts
const router = new NodeRouter({
  cors: {
    origin: 'https://app.example.com',
    credentials: true,
  },
  authenticateConnection: async ({ headers }) => {
    const session = await auth.api.getSession({ headers });
    return session
      ? { id: session.user.id, sessionId: session.session.id }
      : null;
  },
});

router
  .onAuthorizeSubscription('/users/:userId/events', (connection, params) => {
    return connection.getIdentity()?.id === params.userId;
  })
  .onValidateBroadcast('/users/:userId/events', (connection, params) => {
    return connection.getIdentity()?.id === params.userId;
  });
```

Returning `null` from `authenticateConnection` rejects the HTTP or WebSocket
handshake. Browsers send same-origin HttpOnly cookies automatically; application
code does not need to expose a session token to JavaScript.

`authenticateConnection` protects persistent Neorest transports. Plain HTTP
routes remain ordinary independent requests and must use route middleware (or
the host framework's authentication). Cookie-backed apps commonly set
`disableHttpRoutes: true` and keep plain HTTP handling in their framework.

The Node adapter also provides held long polling, configurable CORS, a default
1 MiB payload limit, 600 HTTP requests/minute per client address, and a default
100 protocol messages/second per connection. All limits are configurable.

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

For a short explanation of how Neorest connections, transport upgrades, and
reconnects work, see [docs/connections.md](docs/connections.md).

For the proposed Sila2 app API and WebRTC voice boundary, see
[docs/sila2-integration.md](docs/sila2-integration.md).

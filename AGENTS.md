This is a context for AI editor/agent about the project. It's generated with a tool Airul (https://github.com/mitkury/airul) out of 3 sources. Edit .airul.json to change sources or enabled outputs. After any change to sources or .airul.json, run `airul gen` to regenerate the context.

# From README.md:

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
---

# From docs/architecture.md:

## Neorest Architecture

For the connection/session lifecycle specifically, see [docs/connections.md](/Users/dk/repos/neorest/docs/connections.md).

### Workspace

- `packages/neorest`: published runtime package
- `packages/tests`: Vitest coverage
- `packages/benchmark`: benchmark and stress scripts
- `packages/playground`: demo apps

### Runtime layout

Inside `packages/neorest/src`:

- `core/`: shared protocol types, `ConnectionBase`, router, server connection, auth helper, path matching
- `node/`: `NodeRouter`, HTTP server adapter, Node-only transports
- `transports/`: client transports for WebSocket, HTTP long-polling, and auto-upgrade
- `Client.ts` and `ClientConnection.ts`: public client API and client-side connection state

### Core model

- `ConnectionBase` owns message IDs, ack/resend bookkeeping, headers, rate limiting, and response callbacks.
- `ClientConnection` extends it with reconnect logic, route validation, route subscriptions, and auth headers.
- `ServerConnection` extends it with route handling, immutable handshake
  identity, inbound rate limiting, and subscription management callbacks wired
  by `Router`.
- `Router` stores inbound handlers and outbound subscription matchers, then delegates actual I/O to a server adapter.

### Protocol

The transport layer moves `MsgWrapper` envelopes containing typed messages:

- route requests: `ROUTE_MESSAGE`
- subscriptions: `ON_ROUTE`, `OFF_ROUTE`
- metadata: `DATA_SET`
- liveness: `PING`
- replies: `RESPONSE`

User-facing request methods return `RouteResponse<T>`. Subscription callbacks receive `BroadcastEvent<T>`.

### Client transports

- `WebSocketTransport`: browser-style WebSocket client transport
- `HttpTransport`: handshake + held long-poll/send HTTP fallback under `/.neorest`
- `AutoTransport`: connects over HTTP first, then upgrades to WebSocket when available and falls back to HTTP on WS send failure

### Node server side

- `NodeRouter` is the public server entrypoint.
- `NodeServerAdapter` can create a standalone HTTP/HTTPS server or expose
  composable request and WebSocket-upgrade handlers for an existing server.
- Plain HTTP access to registered routes is enabled by default and can be disabled with `disableHttpRoutes`.
- WebSocket support can be disabled explicitly with `disableWebSocket`.
- Handshake authentication can bind cookie-backed application identity to a
  connection before any protocol message or subscription is accepted.
- CORS, payload limits, held-poll duration, HTTP request limits, connection
  limits, and per-connection protocol message limits are configurable.

### Tested flows

The test suite currently covers:

- HTTP client to Node server request/response
- WebSocket client to Node server request/response
- auto transport HTTP-first flow with WS upgrade
- auto transport HTTP-only fallback
- plain HTTP routes
- reconnect and subscription restoration
- auth middleware and per-subscriber broadcast validation
- handshake identity and subscription-registration authorization
- existing-server handler composition
- held long polling, configurable origins, and server-side limits
- path conflict resolution and duplicate-subscription prevention

### Minimal usage

```ts
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';

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

const client = new Client('http://localhost:8080', 'auto');
await client.connect();

await client.subscribe('/messages', (evt) => {
  console.log(evt.data);
});

await client.post('/messages', { text: 'hello' });
```

### Notes

- Browser clients use `neorest`.
- Node servers use `neorest/node`.
- Client-side routes disallow `:`, while server route patterns support parameters such as `/topic/:name`.
- HTTP transport responses may contain multiple queued protocol messages; the client transport handles both single and array responses.
---

# From package.json:

{
  "name": "neorest-monorepo",
  "version": "0.1.0",
  "private": true,
  "description": "REST APIs with WebSockets. Do regular REST operations (GET, POST, DELETE) on routes, and subscribe to them.",
  "author": "Dmitry Kury (https://dkury.com)",
  "license": "MIT",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build -w neorest",
    "test": "npm run build && npm run test -w @neorest/tests"
  },
  "overrides": {
    "brace-expansion": "^2.0.2",
    "glob": "^10.5.0",
    "minimatch": "^9.0.7",
    "rollup": "^4.59.0",
    "vite": "^6.3.6"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/mitkury/neorest.git"
  },
  "homepage": "https://github.com/mitkury/neorest",
  "keywords": [
    "REST",
    "WebSockets",
    "API",
    "Real-time",
    "Subscriptions"
  ],
  "devDependencies": {
    "tsup": "^8.5.1",
    "typescript": "^5.0.0",
    "vitest": "^3.2.4"
  }
}
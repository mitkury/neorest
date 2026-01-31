This is a context for AI editor/agent about the project. It's generated with a tool Airul (https://github.com/mitkury/airul) out of 3 sources. Edit .airul.json to change sources or enabled outputs. After any change to sources or .airul.json, run `airul gen` to regenerate the context.

# From README.md:

# Neorest

Create real-time routes on top of your REST APIs. Perform regular REST operations (GET, POST, DELETE) on routes, and subscribe to them for live updates. Under the hood, Neorest uses WebSockets (and HTTP long-polling) to deliver real-time events.

## Why?

Other libraries treat real-time as separate from REST, adding complexity. When you design an API, you already define routes. If you can GET/POST a route, you can SUBSCRIBE to it.
For example:
- `/users/{id}`
- `/posts/{id}`
- `/posts/{id}/comments`
- `/chat/threads/{id}`

## Quick start

```bash
npm install neorest
npm test
```

This will build the package and run unit tests that cover:
- HTTP long-polling client ↔ Node server
- WebSocket client ↔ Node server
- Multi-runtime support (Node.js, Browser)

## Multi-Runtime Support

Neorest works across multiple runtimes with a single package:

- **Node.js**: Server and client support
- **Browser**: Client support with WebSocket and HTTP fallback

## Package Structure

- `packages/neorest`: Main package with multi-runtime support
- `packages/tests`: Unit tests (Vitest)
- `packages/benchmark`: Performance benchmarking and stress testing suite
- `packages/playground`: Example applications and demos
- `packages/e2e-tests`: E2E tests (Playwright, planned)

## Usage

### Client (Browser/Node.js)

```typescript
import { Client } from 'neorest';

// Create a client
const client = new Client('ws://localhost:3000');

// Make REST requests
const response = await client.get('/users');
const user = await client.post('/users', { name: 'John' });
await client.delete('/users/123');

// Subscribe to real-time updates
client.subscribe('/users', (event) => {
  console.log('User updated:', event.data);
});
```

### Server (Node.js)

```typescript
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter();

// Define routes
router.get('/users', (ctx) => {
  ctx.response = { users: [] };
});

router.post('/users', (ctx) => {
  const user = ctx.data;
  // Save user...
  ctx.response = { id: 123, ...user };
  
  // Broadcast to subscribers
  router.broadcast('/users', { action: 'POST', data: user });
});

// Start server
await router.start(3000);
```

## Plain HTTP routes (browser-friendly)

- Routes you register on the server are also available over regular HTTP.
- Open a browser to `http://localhost:8080/ping` and you’ll get a JSON response.
- Subscriptions/events still use WebSocket (preferred) or HTTP long-polling under `/.neorest`.

Example:

```ts
// Server
import { NodeRouter } from 'neorest/node';
const router = new NodeRouter({ port: 8080 });
router
  .onGet('/ping', (ctx) => { ctx.response = 'pong'; })
  .onPost('/echo', (ctx) => { ctx.response = ctx.data; });
await router.listen();
```

```bash
# Browser or curl
curl http://localhost:8080/ping
# => "pong"

curl -X POST http://localhost:8080/echo \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
# => {"hello":"world"}
```

Transport endpoints for the Neorest protocol live under `/.neorest`:
- `GET /.neorest` (handshake, returns `{ clientId }`)
- `GET /.neorest?poll=true&clientId=...` (poll for messages)
- `POST /.neorest?clientId=...` (send a message)

To disable plain HTTP routes (only expose `/.neorest` transport), pass `disableHttpRoutes: true` to `NodeRouter`.

## Scripts

- `npm test`: builds package and runs unit tests
- `npm run test:unit`: alias to `npm test`
- `npm run test:e2e`: placeholder for Playwright E2E

## Performance Benchmarking

The project includes a comprehensive benchmarking suite to test performance and detect memory leaks:

```bash
# Run full benchmark suite
cd packages/benchmark
node benchmark.js full

# Run stress test only
node benchmark.js stress --connections=100 --messages=50

# Run memory leak test only
node benchmark.js memory --iterations=50 --connections-per-iter=20
```

The benchmark suite includes:
- **Stress Testing**: Tests connection limits and message throughput
- **Memory Leak Detection**: Identifies memory leaks in connection lifecycle
- **Performance Metrics**: Detailed performance analysis and reporting
- **Automated Testing**: Easy-to-use CLI interface with configurable parameters

See `packages/benchmark/README.md` for detailed usage instructions.

## Development Status

Multi-runtime support with production-ready features:
- ✅ Core architecture
- ✅ WebSocket strategy (client + server)
- ✅ HTTP long-polling strategy (client + server)
- ✅ Node.js router and adapter
- ✅ Multi-runtime package structure
- ✅ Unit tests that verify HTTP and WebSocket flows
- 🚧 E2E tests (Playwright)
- 🚧 Auth/security, versioning, metrics, docs

## License

MIT
---

# From docs/architecture.md:

## Neorest Architecture

This document describes the architecture of Neorest.

### Package Structure

- **packages/neorest**: Main package with multi-runtime support
  - **src/core/**: Shared types, protocol, base connection class, and strategy interfaces
  - **src/node/**: Node.js adapter (HTTP server, optional WebSocket via `ws`), Node strategies
  - **src/deno/**: Deno adapter and strategies
  - **src/browser/**: Browser-specific code (if needed)
  - **src/**: Universal client (Browser/Node/Deno) and client strategies (WebSocket, HTTP long‑polling)
- **packages/tests**: Unit tests validating HTTP and WebSocket flows
- **packages/playground**: Example applications and demos

### Core Package (`neorest/core`)

- **Strategy interfaces** (`CommunicationStrategy`, `ClientStrategy`, `ServerStrategy`):
  - `connect()`, `disconnect()`, `send(message)`, `onMessage(cb)`, `onClose(cb)`, `onOpen(cb)`, `isConnected()`
  - `ClientStrategy`: `setAuthentication(authData)`, `getConnectionInfo()`
  - `ServerStrategy`: `handleConnection(connection)` (for WS) and `broadcast(message, filter?)`

- **ConnectionBase**: Base class used by both client and server connections
  - Rate limiting and message resend bookkeeping
  - Message handler registry and response callbacks
  - Header storage and lifecycle hooks (`onOpen`, `onClose`, `onDataSet`)
  - Integrates with a concrete strategy to send/receive `MsgWrapper`

- **Protocol types** (subset):
  - `MsgWrapper { id, msg, meta }`
  - `ROUTE_MESSAGE`, `MsgRoute { verb, route, data, headers? }`
  - Subscribe/unsubscribe: `ON_ROUTE`, `OFF_ROUTE`
  - Responses: `MsgResponse`, helpers like `new_MsgResponseOK`
  - High‑level `RouteResponse<T>` returned to user code
  - `BroadcastEvent { action: "POST" | "DELETE" | "UPDATE"; data }`

### Client (`neorest`)

- **Client** (`packages/neorest/src/Client.ts`)
  - Constructor: `new Client(url, strategyType = 'auto', options?)`
  - Methods: `get`, `post`, `delete`, `postAndForget`, `on(route, cb)`, `off(route)`, `isConnected`, `getURL`, `setUrl`
  - Delegates to `ClientConnection`
  - Default strategy is `auto` which connects via HTTP long‑polling first, then upgrades to WebSocket when available

- **ClientConnection**
  - Extends `ConnectionBase`
  - Generates a connection `secret` and sends it via a `DATA_SET` message on connect
  - `sendToRoute`/`sendToRouteAndForget` for request/response and fire‑and‑forget flows
  - Subscriptions: `on(route, cb)` sends `ON_ROUTE`; `off(route)` sends `OFF_ROUTE`
  - Validates client routes (alphanumeric, `/`, `_`, `-`; colons disallowed client‑side)
  - Reconnection with backoff and automatic resubscription

- **Client strategies**
  - WebSocket: Uses browser `WebSocket`; forwards messages and lifecycle events
  - HTTP long‑polling: Handshake to obtain `clientId`, `POST` to send, `GET ?poll=true` to receive queued messages
    - Adds auth headers if provided via `setAuthentication`
  - Auto: Starts over HTTP long‑polling for immediate connectivity, attempts a background WebSocket upgrade, and prefers WS for sending once connected; if WS send fails, falls back to HTTP `POST` transparently. Receives messages from whichever transports are active.

### Router Core (`neorest/core`)

- **Router**
  - Manages active `ServerConnection`s keyed by connection secret
  - Incoming routes (`inRoutes`) and outgoing routes (`outRoutes`) with path matching via `path-to-regexp` compatible util
  - Chainable registration for verbs (e.g., `onGet`, `onPost`, `onDelete`)
  - Broadcast helpers: `broadcastPost`, `broadcastDeletion`, `broadcastUpdate`
  - `onValidateBroadcast(route, validateFn)` to gate broadcast delivery per connection/params
  - `handleRouteMessage` creates a `RequestContext` `{ params, data, headers, sender, route }`, invokes handler, and returns `RouteResponse`

- **ServerConnection**
  - Extends `ConnectionBase`
  - Registers internal handlers for `ROUTE_MESSAGE`, `ON_ROUTE`, `OFF_ROUTE`
  - Exposes callbacks the `Router` assigns: `onRouteMessage`, `onSubscribeToRoute`, `onUnsubscribeFromRoute`
  - Provides `sendToRoute` to emit from server → client

- **Server strategies**
  - `WebSocketStrategy` (platform‑agnostic, browser WS API interface)
  - `HttpStrategyBase` for long‑polling on the server side; per‑client message queue, polling timeout, and `processMessage`

### Node Router (`neorest/node`)

- **NodeRouter**: Extends `Router`; wires the `NodeServerAdapter` and delegates `listen()/close()` to it

- **NodeServerAdapter**
  - Creates HTTP/HTTPS server
  - Tries to enable WebSocket if `ws` is installed (dynamic import); handles `upgrade`
  - Option `disableWebSocket` to force HTTP‑only mode (useful for deployments and tests)
  - HTTP interface (transport under `/.neorest`):
    - `GET /.neorest` without `clientId` → returns `{ clientId }` (handshake)
    - `GET /.neorest?poll=true&clientId=...` → returns queued messages or 204
    - `POST /.neorest?clientId=...` with a serialized `MsgWrapper` → enqueues/dispatches; after a brief wait, returns any queued messages as an array (e.g. immediate response and broadcasts) or 202 when none
    - CORS preflight support
  - Associates each `clientId` with a server `HttpStrategy` (extends `HttpStrategyBase`) and registers connections with the router

- **Node strategies**
  - `WebSocketStrategy` wrapping `ws` sockets
  - `HttpStrategy` that derives from `HttpStrategyBase`

### End‑to‑End Flows (from tests)

- HTTP: `Client('http://host', 'http' | 'auto')` ↔ `NodeRouter`
  - `GET /ping` → `"pong"`
  - `POST /echo` → echoes payload

- Auto (HTTP‑first with WS upgrade): `Client('http://host', 'auto')` ↔ `NodeRouter`
  - Immediately connects via HTTP long‑polling; upgrades to WS if available
  - Uses `/.neorest` for HTTP handshake/poll/send
  - Sends prefer WS once connected; if WS send fails, transparently falls back to HTTP POST
  - Subscriptions and broadcasts delivered over active transports

- WebSocket: `Client('ws://host', 'websocket')` ↔ `NodeRouter`
  - Request/response as above
  - Subscriptions via `client.on('/topic/news', cb)`; server uses `broadcastPost('/topic/news', data)`

- Plain HTTP routes (browser-friendly):
  - Access registered routes directly: `GET /ping`, `POST /echo`
  - Returns JSON by default; same handlers and middleware as protocol invocations

### Multi-Runtime Support

- **Node.js**: Full server and client support with WebSocket and HTTP long-polling
- **Deno**: Full server and client support with native WebSocket and HTTP APIs
- **Browser**: Client support with WebSocket and HTTP fallback strategies

### Implementation Status

- **Implemented**: split client/server connections, message protocol, broadcast API, reconnection, Node adapter, HTTP long‑polling and WebSocket strategies, type‑safe `RouteResponse<T>`, multi-runtime package structure
- **Partially/Not yet**: token‑based auth (currently a per‑connection secret is set and sent); SSE strategy; richer `RequestContext` helpers

### Minimal Usage

```ts
// Server (Node.js)
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ port: 8080 });
router
  .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
  .onPost('/messages', async (ctx) => {
    ctx.response = ctx.data;
    router.broadcastPost('/messages', ctx.data, ctx.sender);
  });
await router.listen();

// Client (any runtime)
import { Client } from 'neorest';
const client = new Client('ws://localhost:8080', 'websocket');
await (client as any).conn.connect();
const pong = await client.get('/ping');
await client.on('/messages', (evt) => console.log('broadcast', evt.data));
await client.post('/messages', { text: 'hello' });
```

### Notes

- WebSocket support on Node is optional; install `ws` to enable it at runtime.
- You can force HTTP‑only mode by passing `disableWebSocket: true` to `NodeRouter` options.
- Client routes disallow `:`; the server internally supports parameterized routes like `/topic/:name` for matching and validation.
- HTTP `POST` responses may return an array of messages (e.g., immediate response and queued broadcasts). The client HTTP strategy handles both single and array payloads.
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
    "build": "npm run build -w @neorest/core && npm run build -w neorest",
    "test": "npm run build && npm run test -w @neorest/tests"
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
    "typescript": "^5.0.0"
  }
}
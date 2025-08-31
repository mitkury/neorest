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



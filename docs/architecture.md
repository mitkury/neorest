## Neorest Architecture (Current)

This document describes the current, implemented architecture of Neorest.

### Monorepo Overview

- **packages/core**: Shared types, protocol, base connection class, and strategy interfaces
- **packages/neorest**: Universal client (Browser/Node) and client strategies (WebSocket, HTTP long‑polling)
- **packages/router-core**: Platform‑agnostic router, route matching, server connection, server strategies base
- **packages/router-node**: Node.js adapter (HTTP server, optional WebSocket via `ws`), Node strategies
- **packages/router-deno**: Deno adapter (not in the default Node build/tests)
- **packages/tests**: Unit tests validating HTTP and WebSocket flows

### Core Package (`@neorest/core`)

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
  - Constructor: `new Client(url, strategyType = 'websocket', options?)`
  - Methods: `get`, `post`, `delete`, `postAndForget`, `on(route, cb)`, `off(route)`, `isConnected`, `getURL`, `setUrl`
  - Delegates to `ClientConnection`

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

### Router Core (`@neorest/router-core`)

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

### Node Router (`@neorest/router-node`)

- **NodeRouter**: Extends `Router`; wires the `NodeServerAdapter` and delegates `listen()/close()` to it

- **NodeServerAdapter**
  - Creates HTTP/HTTPS server
  - Tries to enable WebSocket if `ws` is installed (dynamic import); handles `upgrade`
  - HTTP interface:
    - `GET` without `clientId` → returns `{ clientId }` (handshake)
    - `GET ?poll=true&clientId=...` → returns queued messages or 204
    - `POST` with a serialized `MsgWrapper` → enqueues/dispatches; returns immediate response message if present or 202
    - CORS preflight support
  - Associates each `clientId` with a server `HttpStrategy` (extends `HttpStrategyBase`) and registers connections with the router

- **Node strategies**
  - `WebSocketStrategy` wrapping `ws` sockets
  - `HttpStrategy` that derives from `HttpStrategyBase`

### End‑to‑End Flows (from tests)

- HTTP: `Client('http://host', 'http')` ↔ `NodeRouter`
  - `GET /ping` → `"pong"`
  - `POST /echo` → echoes payload

- WebSocket: `Client('ws://host', 'websocket')` ↔ `NodeRouter`
  - Request/response as above
  - Subscriptions via `client.on('/topic/news', cb)`; server uses `broadcastPost('/topic/news', data)`

### Alignment with the older spec

- **Implemented**: split client/server connections, message protocol, broadcast API, reconnection, Node adapter, HTTP long‑polling and WebSocket strategies, type‑safe `RouteResponse<T>`
- **Partially/Not yet**: token‑based auth (currently a per‑connection secret is set and sent); SSE strategy; richer `RequestContext` helpers; Deno path is present but not in the default build/tests

### Minimal Usage

```ts
// Server (Node)
import { NodeRouter } from '@neorest/router-node';

const router = new NodeRouter({ port: 8080 });
router
  .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
  .onPost('/messages', async (ctx) => {
    ctx.response = ctx.data;
    router.broadcastPost('/messages', ctx.data, ctx.sender);
  });
await router.listen();

// Client
import { Client } from 'neorest';
const ws = new Client('ws://localhost:8080', 'websocket');
await (ws as any).conn.connect();
const pong = await ws.get('/ping');
await ws.on('/messages', (evt) => console.log('broadcast', evt.data));
await ws.post('/messages', { text: 'hello' });
```

### Notes

- WebSocket support on Node is optional; install `ws` to enable it at runtime.
- Client routes disallow `:`; the server internally supports parameterized routes like `/topic/:name` for matching and validation.



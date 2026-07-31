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
- `transports/`: client transports for WebTransport, WebSocket, HTTP
  long-polling, and adaptive auto-upgrade
- `Client.ts` and `ClientConnection.ts`: public client API and client-side connection state

### Core model

- `ConnectionBase` owns message IDs, response correlation, duplicate-request
  handling, headers, rate limiting, and response callbacks.
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
- `WebTransportTransport`: exchanges the authenticated HTTP bootstrap for a
  single-use HTTP/3 upgrade and adapts one framed bidirectional stream
- `AutoTransport`: connects over HTTP first, then tries WebTransport and
  WebSocket in preference order and falls back to held HTTP

### Node server side

- `NodeRouter` is the public server entrypoint.
- `NodeServerAdapter` can create a standalone HTTP/HTTPS server or expose
  composable request and WebSocket-upgrade handlers for an existing server.
- Plain HTTP access to registered routes is enabled by default and can be disabled with `disableHttpRoutes`.
- WebSocket support can be disabled explicitly with `disableWebSocket`.
- WebTransport support is opt-in. It runs through a small provider boundary so
  the HTTP/3 implementation can be replaced without changing Router or
  Connection code.
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
- WebTransport framing, bootstrap tickets, immutable identity, and a real
  HTTP/3 route flow
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

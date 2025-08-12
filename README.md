# Neorest

Create real-time routes on top of your REST APIs. Perform regular REST operations (GET, POST, DELETE) on routes, and subscribe to them for live updates. Under the hood, Neorest uses WebSockets (and HTTP long-polling) to deliver real-time events.

## Why?

Other libraries treat real-time as separate from REST, adding complexity. When you design an API, you already define routes. If you can GET/POST a route, you can SUBSCRIBE to it.
For example:
- `/users/{id}`
- `/posts/{id}`
- `/posts/{id}/comments`
- `/chat/threads/{id}`

## Quick start (NodeJS + Browser focus)

- npm install
- npm test

This will build the NodeJS-related packages and run unit tests that cover:
- HTTP long-polling client ↔ Node server
- WebSocket client ↔ Node server

## Packages

- `packages/core`: Core types, interfaces, and utilities
- `packages/neorest`: Client (Browser/Node) with HTTP + WebSocket strategies
- `packages/router-core`: Router base implementation (platform-agnostic)
- `packages/router-node`: Node.js server adapter and strategies
- `packages/tests`: Unit tests (Vitest)
- `packages/e2e-tests`: E2E tests (Playwright, planned)

Deno-specific code lives in `packages/router-deno`, but it is not part of the default NodeJS unit test and build flow.

## Usage

```typescript
// Client (Browser/Node)
import { Client } from 'neorest';

// WebSocket
const wsClient = new Client('ws://localhost:8080', 'websocket');
await (wsClient as any).conn.connect();
await wsClient.post('/messages', { text: 'hello' });

// HTTP long-polling
const httpClient = new Client('http://localhost:8080', 'http');
await (httpClient as any).conn.connect();
const pong = await httpClient.get('/ping');
```

## Plain HTTP routes (browser-friendly)

- Routes you register on the server are also available over regular HTTP.
- Open a browser to `http://localhost:8080/ping` and you’ll get a JSON response.
- Subscriptions/events still use WebSocket (preferred) or HTTP long-polling under `/.neorest`.

Example:

```ts
// Server
import { NodeRouter } from '@neorest/router-node';
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

- `npm test`: builds Node packages and runs unit tests
- `npm run test:unit`: alias to `npm test`
- `npm run test:e2e`: placeholder for Playwright E2E

## Development Status

Focusing on a production-ready NodeJS + Browser setup first:
- ✅ Core architecture
- ✅ WebSocket strategy (client + server)
- ✅ HTTP long-polling strategy (client + server)
- ✅ Node.js router and adapter
- ✅ Unit tests that verify HTTP and WebSocket flows
- 🚧 E2E tests (Playwright)
- 🚧 Auth/security, versioning, metrics, docs

## License

MIT
# Neorest

REST APIs with WebSockets. Do regular REST operations (GET, POST, DELETE) on routes, and subscribe to them.

## Why?

Other libraries treat real-time channels as separate from REST APIs. That's unnecessary. When you create an API, you create structure already:

- `/users/{id}`
- `/posts/{id}`
- `/posts/{id}/comments`
- `/chat/threads/{id}`

If you can POST and GET to these endpoints, why not SUBSCRIBE to them too?

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
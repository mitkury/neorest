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
- Multi-runtime support (Node.js, Deno, Browser)

## Multi-Runtime Support

Neorest works across multiple runtimes with a single package:

- **Node.js**: Server and client support
- **Deno**: Server and client support  
- **Browser**: Client support with WebSocket and HTTP fallback

## Package Structure

- `packages/neorest`: Main package with multi-runtime support
- `packages/tests`: Unit tests (Vitest)
- `packages/playground`: Example applications and demos
- `packages/e2e-tests`: E2E tests (Playwright, planned)

## Usage

### Client (Browser/Node.js/Deno)

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

### Server (Deno)

```typescript
import { DenoRouter } from 'neorest/deno';

const router = new DenoRouter();

// Define routes
router.get('/users', (ctx) => {
  ctx.response = { users: [] };
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

## Development Status

Multi-runtime support with production-ready features:
- ✅ Core architecture
- ✅ WebSocket strategy (client + server)
- ✅ HTTP long-polling strategy (client + server)
- ✅ Node.js router and adapter
- ✅ Deno router and adapter
- ✅ Multi-runtime package structure
- ✅ Unit tests that verify HTTP and WebSocket flows
- 🚧 E2E tests (Playwright)
- 🚧 Auth/security, versioning, metrics, docs

## License

MIT
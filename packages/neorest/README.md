# Neorest

REST APIs with WebSockets. Do regular REST operations (GET, POST, DELETE) on routes, and subscribe to them.

## Features

- **Multi-runtime support**: Works in Node.js, Deno, and browsers
- **REST API**: Standard HTTP operations (GET, POST, DELETE)
- **Real-time subscriptions**: Subscribe to routes for live updates
- **WebSocket support**: Efficient real-time communication
- **HTTP fallback**: Long-polling for environments without WebSockets
- **TypeScript**: Full TypeScript support with type safety

## Installation

```bash
npm install neorest
```

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

## Multi-Runtime Support

This package uses conditional exports to provide the right code for each runtime:

- **Node.js**: Uses `neorest` or `neorest/node` for server-side functionality
- **Browser**: Uses `neorest` for client-side functionality
- **Deno**: Uses `neorest` or `neorest/deno` for server-side functionality

### Import Examples

```typescript
// Node.js server
import { NodeRouter } from 'neorest/node';

// Browser client
import { Client } from 'neorest';

// Deno server
import { DenoRouter } from 'neorest/deno';

// Core types and utilities
import { Router, ServerConnection } from 'neorest/core';
```

## API Reference

### Client

- `new Client(url, transport?, options?)` - Create a new client
- `client.get(route, headers?)` - Send GET request
- `client.post(route, data?, headers?)` - Send POST request
- `client.delete(route, headers?)` - Send DELETE request
- `client.subscribe(route, callback)` - Subscribe to route updates
- `client.unsubscribe(route)` - Unsubscribe from route updates

### Router (Server)

- `new Router(options?)` - Create a new router
- `router.get(route, handler)` - Define GET route
- `router.post(route, handler)` - Define POST route
- `router.delete(route, handler)` - Define DELETE route
- `router.broadcast(route, event)` - Broadcast to route subscribers

### Request Context

```typescript
interface RequestContext {
  params: Record<string, string>;  // Route parameters
  data: any;                       // Request payload
  headers: Record<string, string>; // Request headers
  sender: ServerConnection;        // Connection that sent the request
  route: string;                   // Route path
  response: any;                   // Response data
  error?: string;                  // Error message
  statusCode?: number;             // HTTP status code
}
```

## Development

```bash
# Build all targets
npm run build

# Build specific targets
npm run build:node
npm run build:browser
npm run build:deno

# Clean build artifacts
npm run clean
```

## License

MIT
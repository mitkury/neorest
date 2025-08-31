# Neorest Simplest Example

A minimal example demonstrating Neorest's core functionality with both HTTP and WebSocket support.

## Features Demonstrated

- ✅ **HTTP Routes**: Access routes directly via HTTP
- ✅ **WebSocket Client**: Connect and make requests via WebSocket
- ✅ **Real-time Subscriptions**: Subscribe to live updates
- ✅ **Broadcasting**: Server broadcasts updates to all subscribers
- ✅ **State Management**: Simple counter with real-time updates

## Quick Start

```bash
cd packages/playground/simplest
npm install
npm run dev
```

This will start:
- **Server**: Neorest server on http://localhost:3000
- **Client**: Web interface on http://localhost:3001

## What You Can Test

### HTTP Routes (Browser-friendly)
- `GET /ping` - Returns a pong message
- `POST /echo` - Echoes back your data
- `GET /counter` - Returns current counter value
- `POST /counter/increment` - Increments the counter

### WebSocket Features
- Connect to WebSocket at `ws://localhost:3000`
- Make the same requests via WebSocket
- Subscribe to real-time updates:
  - `/counter` - Live counter updates
  - `/messages` - Echo message broadcasts

### Real-time Demo
1. Open the web interface
2. Click "Connect WebSocket"
3. Subscribe to `/counter`
4. Click "WS POST /counter/increment"
5. Watch the counter update in real-time!

## Server Code

```typescript
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ port: 3000 });

// Simple GET route
router.get('/ping', (ctx) => {
  ctx.response = { message: 'pong', timestamp: Date.now() };
});

// Simple POST route with broadcasting
router.post('/echo', (ctx) => {
  ctx.response = { message: 'echo', data: ctx.data };
  
  // Broadcast to all subscribers
  router.broadcast('/messages', { 
    action: 'POST', 
    data: { message: 'New echo received', data: ctx.data }
  });
});

// Counter with real-time updates
let counter = 0;
router.post('/counter/increment', (ctx) => {
  counter++;
  ctx.response = { count: counter };
  
  // Broadcast the new count
  router.broadcast('/counter', { 
    action: 'UPDATE', 
    data: { count: counter }
  });
});

await router.listen();
```

## Client Code

```typescript
import { Client } from 'neorest';

// Connect to WebSocket
const client = new Client('ws://localhost:3000', 'websocket');
await client.conn.connect();

// Make requests
const response = await client.get('/ping');
const echo = await client.post('/echo', { message: 'Hello!' });

// Subscribe to real-time updates
await client.subscribe('/counter', (event) => {
  console.log('Counter updated:', event.data);
});
```

## Routes Available

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/ping` | Returns pong message |
| POST | `/echo` | Echoes data and broadcasts |
| GET | `/counter` | Returns current counter |
| POST | `/counter/increment` | Increments counter and broadcasts |

## Subscriptions Available

| Route | Description |
|-------|-------------|
| `/counter` | Real-time counter updates |
| `/messages` | Echo message broadcasts |

## Try It Out!

1. **Start the server**: `npm run dev:server`
2. **Open the web interface**: http://localhost:3001
3. **Test HTTP routes**: Use the HTTP testing buttons
4. **Connect WebSocket**: Click "Connect WebSocket"
5. **Test real-time features**: Subscribe and watch live updates!

This example shows how Neorest unifies HTTP and WebSocket communication in a simple, intuitive way.
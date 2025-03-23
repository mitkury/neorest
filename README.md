# Neorest

REST APIs with WebSockets. Do regular REST operations (GET, POST, DELETE) on routes, and subscribe to them.

## Why?

Other libraries treat real-time channels as separate from REST APIs. That's unnecessary. When you create an API, you create structure already:

- `/users/{id}`
- `/posts/{id}`
- `/posts/{id}/comments`
- `/chat/threads/{id}`

If you can POST and GET to these endpoints, why not SUBSCRIBE to them too?

## Usage

```typescript
// Post a message
client.post('/direct-message/edoardo', { message });

// Listen for new messages
client.on('/direct-message/edoardo', (res) => { 
    console.log(res.data);
});
```

## Features

- Unified REST and real-time API
- Multiple communication strategies (WebSocket, HTTP long-polling)
- Route subscription and broadcasting
- Cross-platform support (Deno, Node.js, browsers)
- Type-safe API
- Reconnection handling
- Multi-platform router support

## Examples

### Deno Example

There's a simplified Deno example that demonstrates the core functionality:

```bash
# Run the test script
deno run -A packages/examples/src/deno-simple/run_test.ts
```

This will:
1. Start a Deno server with WebSocket support
2. Connect a client to the server
3. Subscribe to route updates
4. Send and receive messages
5. Broadcast updates to subscribed clients

## Project Structure

The project is organized as a monorepo with the following packages:

- `core`: Core types, interfaces, and utilities
- `neorest`: Client implementation
- `router-core`: Router base implementation
- `router-deno`: Deno-specific router
- `router-node`: Node.js-specific router
- `examples`: Usage examples for different platforms

## Development Status

This project is under active development. Current progress:
- ✅ Core architecture
- ✅ WebSocket strategy
- ✅ Deno example implementation
- 🚧 HTTP strategy
- 🚧 Node.js router
- 🚧 Documentation and tests
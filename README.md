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

## Tests

The project contains integration tests to verify core functionality:

```bash
# Run the core integration tests
npm run test:core:integration
```

These tests verify:
1. Basic WebSocket communication
2. Message passing between client and server
3. Route handling and responses
4. Error handling

## Project Structure

The project is organized as a monorepo with the following packages:

- `packages/core`: Core types, interfaces, and utilities
- `packages/neorest`: Client implementation
- `packages/router-core`: Router base implementation
- `packages/router-deno`: Deno-specific router
- `packages/router-node`: Node.js-specific router

Tests are organized in the `tests/` directory, with platform-specific subdirectories.

## Development Status

This project is under active development. Current progress:
- ✅ Core architecture
- ✅ WebSocket strategy
- ✅ Core integration tests
- ✅ Monorepo structure
- 🚧 HTTP strategy
- 🚧 Node.js router
- 🚧 Browser compatibility
- 🚧 Authentication and security features
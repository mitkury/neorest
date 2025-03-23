# Neorest Improvement Proposal
March 23, 2025

## Current State Analysis

Neorest is a promising library that aims to unify REST operations with real-time capabilities through a single API interface. The core concept is that if you can POST and GET to endpoints like `/users/{id}`, you should also be able to SUBSCRIBE to them to receive real-time updates.

### Architecture
- Client-server architecture using WebSockets as the primary transport
- Strategy pattern for communication (WebSocketStrategy, HttpStrategy)
- Router with path matching for handling routes
- Message-based protocol with types, IDs, and acknowledgments

### Issues Identified
1. **Incomplete HTTP Strategy**: The HTTP implementation is marked as WIP and lacks full functionality
2. **Router Connection Handling**: The Router has references to WebSockets directly rather than using strategies
3. **Inconsistent API between strategies**: WebSocket and HTTP strategies have different capabilities 
4. **Missing Server Implementation**: There's no complete server implementation to test against
5. **Limited Tests**: Testing infrastructure is minimal
6. **No Build Process**: The js_build directory contains only a dummy file
7. **Connection Management**: Secret handling is inconsistent between strategies
8. **Monolithic Structure**: Current codebase structure doesn't separate client and server concerns

## Proposed Improvements

### 1. Complete HTTP Strategy Implementation
- Finish the HTTP client strategy to handle all message types
- Implement a proper long-polling mechanism for subscriptions
- Add HTTP server strategy for the backend

### 2. Refactor Router to Use Communication Strategies
- Update the Router to work with CommunicationStrategy instead of directly with WebSockets
- Create a ServerCommunicationStrategy interface to standardize server-side connections

### 3. Standardize API Across Strategies and Split Connection Logic
- Create consistent interfaces for all strategies (WebSocket, HTTP, etc.)
- Split Connection class into ClientConnection and ServerConnection with shared ConnectionBase
- Move authentication/secret handling logic out of Connection into strategies where appropriate
- Make CommunicationStrategy more robust with proper error handling

### 4. Create Complete Server Implementation
- Develop a server reference implementation using the router
- Support both WebSocket and HTTP connections
- Include middleware system for authentication and request processing

### 5. Add Comprehensive Tests
- Create unit tests for all components
- Add integration tests for client-server communication
- Test both WebSocket and HTTP strategies

### 6. Setup Build Process
- Configure TypeScript compilation
- Add bundling for browser and Node.js environments
- Generate proper type definitions

### 7. Improve Documentation
- Add JSDoc comments to all classes and methods
- Create examples for various use cases
- Document the message protocol

### 8. Additional Enhancements
- Add support for message compression
- Implement reconnection with backoff for better reliability
- Add message queue for offline operation
- Create adapters for popular frameworks (Express, Fastify, etc.)

### 9. Reorganize into Monorepo Structure

Restructure the codebase into a monorepo with the following packages:

```
packages/
  core/          // Shared types, message protocols, base strategies
  neorest/       // Universal client package usable in any environment
  router-core/   // Platform-agnostic router functionality
  router-deno/   // Deno-specific router implementation
  router-node/   // Node.js-specific router implementation
  examples/      // Example implementations
```

Benefits of this approach:
- Clear separation between client and server concerns
- Cross-platform compatibility with environment-specific optimizations
- Consistent versioning across all packages
- Code reuse between platforms
- Simplified development workflow
- Better organization for developers consuming the packages

## Implementation Plan

1. First, reorganize the codebase into the monorepo structure
2. Create the ConnectionBase, ClientConnection, and ServerConnection classes
3. Fix the HTTP strategy implementation to make it fully functional
4. Update Router to use strategies and ServerConnection consistently
5. Create server reference implementations for both Deno and Node.js
6. Add tests and documentation
7. Set up build process
8. Implement additional enhancements

## Priorities

The highest priority items are:

1. **Monorepo Structure**: Reorganizing the codebase will provide a solid foundation for further development
2. **Connection Class Refactoring**: Splitting the Connection class will enable proper client-server separation
3. **HTTP Strategy Completion**: This is critical to make the library work across different transport mechanisms
4. **Router Refactoring**: Making the Router work with strategies consistently will enable proper server implementation
5. **Server Reference Implementations**: Working server examples will demonstrate the full capabilities

## Next Steps

1. Create the monorepo structure and relocate existing code
2. Design and implement the ConnectionBase abstract class in the core package
3. Create ClientConnection and ServerConnection implementations in their respective packages
4. Implement a complete HTTP client strategy with proper handling for all message types
5. Update the polling mechanism to efficiently support subscriptions
6. Create platform-agnostic router core functionality
7. Implement Deno and Node.js specific adapters
8. Create basic examples demonstrating the full system
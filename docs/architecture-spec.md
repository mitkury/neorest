# Neorest Architecture Specification

## Overview

This document outlines the architectural design for Neorest, a library that unifies REST operations with real-time capabilities. The architecture is designed around a monorepo structure with clear separation of concerns and cross-platform compatibility.

## Monorepo Structure

```
packages/
  core/          # Shared types, message protocols, base strategies
  neorest/       # Universal client package
  router-core/   # Platform-agnostic router functionality
  router-deno/   # Deno-specific router implementation
  router-node/   # Node.js-specific router implementation
  examples/      # Example implementations
```

## Package Definitions

### 1. Core Package

**Purpose**: Provide shared types, protocols, and base interfaces used by all other packages.

**Components**:
- Message Types (`MsgType`, `MsgRoute`, etc.)
- Communication Strategy Interfaces
- Base Classes for Strategy Implementations
- Utility Functions and Helpers

**Key Interfaces**:
```typescript
// Base communication strategy interface
export interface CommunicationStrategy {
  connect(): Promise<void>;
  disconnect(): void;
  send(message: MsgWrapper): void;
  onMessage(callback: (message: MsgWrapper) => void): void;
  onClose(callback: () => void): void;
  onOpen(callback: () => void): void;
  isConnected(): boolean;
}

// New interfaces for client vs server strategies
export interface ClientStrategy extends CommunicationStrategy {
  setAuthentication(authData: AuthData): void;
  getConnectionInfo(): ConnectionInfo;
}

export interface ServerStrategy extends CommunicationStrategy {
  handleConnection(connection: any): void;
  broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void;
}
```

### 2. Neorest Package (Client)

**Purpose**: Provide a universal client that can connect to Neorest routers from any environment.

**Components**:
- Client Class
- Client Communication Strategies
  - WebSocketStrategy
  - HttpStrategy
  - (Future: SSEStrategy, etc.)
- Client Connection Management

**API** (preserving existing patterns):
```typescript
// Keep the simple constructor with same parameters
class Client {
  constructor(url: string, strategyType: 'websocket' | 'http' = 'websocket');
  
  // Connection management methods (from existing API)
  getURL(): string;
  isConnected(): boolean;
  setUrl(url: string, strategyType?: 'websocket' | 'http'): Promise<void>;
  close(): void;
  
  // Core REST methods (same as current API)
  get<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>>;
  post<T = any>(route: string, payload?: Payload, headers?: Record<string, string>): Promise<RouteResponse<T>>;
  delete<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>>;
  postAndForget(route: string, payload?: Payload, headers?: Record<string, string>): void;
  
  // Subscription methods (with improved typing but same pattern)
  on<T = any>(
    route: string, 
    callback: (broadcast: { action: "POST" | "DELETE" | "UPDATE"; data: T }) => void
  ): Promise<void>;
  
  off(route: string): void;
}

// Add support for type-safe responses
interface RouteResponse<T = any> {
  data: T;
  error?: string;
}
```

**Improvements**:
1. **Type Safety**: Added generic type parameters for better type checking
2. **Consistent API**: Maintained the familiar method signatures
3. **Enhanced Strategies**: The underlying strategies will be improved while keeping the API stable
4. **Better Reconnection**: Will improve the reconnection logic while maintaining the same interface
```

### 3. Router Core Package

**Purpose**: Provide platform-agnostic router functionality that can be used by platform-specific implementations.

**Components**:
- Abstract Router Class
- Route Matching Logic
- Subscription Management
- Message Handling

**Key Interfaces**:
```typescript
export interface RouterOptions {
  // Configuration options
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  validateRoutes?: boolean;
  // etc.
}

export abstract class RouterBase {
  constructor(options?: RouterOptions);
  
  // Preserve existing chainable API for route registration
  onGet(route: string, handler: RouteHandler): this;
  onPost(route: string, handler: RouteHandler): this;
  onDelete(route: string, handler: RouteHandler): this;
  
  // Add route validation (matching current API)
  onValidateBroadcast(
    route: string,
    validate: (
      conn: Connection,
      params: Record<string, string>,
    ) => boolean | Promise<boolean>,
  ): this;
  
  // Broadcast methods (preserving existing API)
  broadcastPost(route: string, payload: Payload, exceptConn?: Connection): void;
  broadcastDeletion(route: string, payload: Payload, exceptConn?: Connection): void;
  broadcastUpdate(route: string, payload: Payload, exceptConn?: Connection): void;
  
  // Internal methods (for platform implementations)
  protected abstract handleConnection(connectionInfo: any): void;
  protected abstract setupServer(): Promise<void>;
}

// Maintain existing context structure with improvements
export interface RequestContext {
  params: Record<string, string>;
  data: Payload;
  headers: Record<string, string>;
  sender: Connection;
  route: string;
  error?: string;
  response: Payload;
  
  // New helper methods
  setResponse(data: Payload): void;
  setError(message: string, status?: number): void;
}

// Route handler definition (matching current implementation)
export type RouteHandler = (ctx: RequestContext) => void | Promise<void>;

// Maintain the internal data structures
export type InRouteLayer = {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  verbs: VerbAndHandler[];
};

export type OutRouteLayer = {
  id: RouteSubID;
  route: string;
  regexp: RegExp;
  match: MatchFunction;
  keys: string[];
  listeners: RouteListener[];
  validate: (
    conn: Connection,
    params: Record<string, string>,
  ) => boolean | Promise<boolean>;
};
```

### 4. Router Deno Package

**Purpose**: Provide a Deno-specific implementation of the Neorest router.

**Components**:
- Deno Router Implementation
- Deno WebSocket Adapter
- Deno HTTP Adapter

**API Example** (preserving existing Router API style):
```typescript
import { Router } from 'neorest/router-deno';

const router = new Router({
  port: 8000,
  // Deno-specific options
  certFile: './cert.pem',
  keyFile: './key.pem'
});

// Use the existing onGet/onPost/onDelete pattern
router
  .onGet('/users', async (ctx) => {
    // Set response data on the context
    ctx.response = await db.getUsers();
  })
  .onPost('/users', async (ctx) => {
    const user = await db.createUser(ctx.data);
    ctx.response = user;
    // Broadcast to all subscribed clients except sender
    router.broadcastPost('/users', { action: 'create', data: user }, ctx.sender);
  })
  .onValidateBroadcast('/users/:id', (conn, params) => {
    // Validate if the user should receive this broadcast
    return conn.hasAccess(params.id);
  });

await router.listen();
```

### 5. Router Node Package

**Purpose**: Provide a Node.js-specific implementation of the Neorest router.

**Components**:
- Node.js Router Implementation
- Node.js WebSocket Adapter
- Node.js HTTP Adapter
- Express/Fastify Integration

**API Example** (preserving existing Router API style):
```typescript
import { Router } from 'neorest/router-node';
// Express integration example
import express from 'express';

const app = express();
const router = new Router({
  // Can attach to existing Express app
  expressApp: app,
  // Or run standalone
  port: 8000
});

// Match the existing API pattern
router
  .onGet('/users', async (ctx) => {
    ctx.response = await db.getUsers();
  })
  .onPost('/users', async (ctx) => {
    const user = await db.createUser(ctx.data);
    ctx.response = user;
    // Use the specific broadcast method matching current API
    router.broadcastPost('/users', user, ctx.sender);
  })
  .onDelete('/users/:id', async (ctx) => {
    await db.deleteUser(ctx.params.id);
    ctx.response = { success: true };
    // Broadcast deletion event
    router.broadcastDeletion(`/users/${ctx.params.id}`, { id: ctx.params.id });
  })
  .onValidateBroadcast('/users/:id', (conn, params) => {
    // Validation logic for broadcasts
    return conn.userData?.hasPermission(`view_user_${params.id}`);
  });

router.listen();
```

## Connection Redesign

The current Connection class handles both client and server-side connection logic, message handling, and acknowledgments. In the new architecture, this will be split across multiple packages:

### Core Package (Connection Base)

```typescript
// In packages/core
export abstract class ConnectionBase {
  protected strategy: CommunicationStrategy;
  protected messageHandlers: MessageHandlerMap;
  protected callbacks: Map<MsgID, (response: RouteResponse) => void>;
  
  constructor(strategy: CommunicationStrategy) {
    this.strategy = strategy;
    this.setupDefaultHandlers();
  }
  
  // Core methods for sending/receiving messages
  protected abstract handleMessage(wrapper: MsgWrapper): void;
  protected abstract setupDefaultHandlers(): void;
  
  // Public API 
  public async connect(): Promise<void> {/* ... */}
  public close(): void {/* ... */}
  public setStrategy(newStrategy: CommunicationStrategy): Promise<void> {/* ... */}
}
```

### Client-Side Connection

```typescript
// In packages/neorest
export class ClientConnection extends ConnectionBase {
  private subscribedRoutes: Record<string, (broadcast: BroadcastEvent) => void>;
  private reconnectOptions: ReconnectOptions;
  
  constructor(strategy: CommunicationStrategy, options?: ConnectionOptions) {
    super(strategy);
    // Initialize client-specific properties
  }
  
  // Client-specific message handling
  protected handleMessage(wrapper: MsgWrapper): void {/* ... */}
  protected setupDefaultHandlers(): void {/* ... */}
  
  // Methods used by Client class
  public sendToRoute(route: string, verb: RouteVerb, payload: Payload, 
                     headers?: Record<string, string>, 
                     callback?: (response: RouteResponse) => void): void {/* ... */}
                     
  public subscribeToRoute(route: string): Promise<void> {/* ... */}
  public unsubscribeFromRoute(route: string): void {/* ... */}
}
```

### Server-Side Connection

```typescript
// In packages/router-core
export class ServerConnection extends ConnectionBase {
  private clientId: string;
  private userData: any;
  private permissions: Set<string>;
  
  constructor(strategy: CommunicationStrategy) {
    super(strategy);
    // Initialize server-specific properties
  }
  
  // Server-specific message handling
  protected handleMessage(wrapper: MsgWrapper): void {/* ... */}
  protected setupDefaultHandlers(): void {/* ... */}
  
  // Methods used by Router class
  public handleRouteMessage(msgId: MsgID, msg: MsgRoute): Promise<RouteResponse> {/* ... */}
  public sendRouteResponse(msgId: MsgID, response: RouteResponse): void {/* ... */}
}
```

### Key Improvements

1. **Separation of Concerns**:
   - Split client and server connection logic
   - Move authentication to appropriate layers
   - Extract message handling into dedicated handlers

2. **Better Strategy Integration**:
   - Strategy-specific features (e.g., acknowledgments for WebSocket but not HTTP) 
   - Protocol optimizations based on transport

3. **Enhanced Reliability**:
   - More robust reconnection logic
   - Better error handling and recovery
   - Message queuing and de-duplication

4. **Improved Testability**:
   - Smaller, more focused classes
   - Clear interfaces between components
   - Mockable dependencies

## Communication Protocol

The core message protocol will remain similar but with enhancements:

1. **Message Types**:
   - Route messages (GET, POST, DELETE)
   - Subscription messages (SUBSCRIBE, UNSUBSCRIBE)
   - Response messages
   - Error messages
   - System messages (PING, RECONNECT)

2. **Message Structure** (preserved from current implementation with additions):
```typescript
interface MsgWrapper {
  id: MsgID | SendAndForgetMsgID;
  msg: MsgType;
  // New optional fields
  meta?: {
    timestamp: number;
    version: string;
    auth?: string;
  };
}

// Various message types preserved from current implementation
interface MsgRoute extends MsgForRoute {
  type: typeof ROUTE_MESSAGE;
  verb: RouteVerb;
  route: string;
  data: Payload;
  headers?: Record<string, string>;
}
```

3. **Type-Safe API Enhancements**:
```typescript
// Using generics for type safety across routes
client.get<User[]>('/users');
client.post<User, UserCreateData>('/users', { name: 'John' });

// Type-safe subscriptions
client.on<PostEvent>('/posts', (event) => {
  // event.data is typed as PostEvent
  console.log(event.data.title);
});
```

## Authentication & Security

1. **Connection Authentication**:
   - Move from connection secrets to token-based auth
   - Support for JWT or custom token verification
   - API keys for server-to-server communication

2. **Route-Level Authorization**:
```typescript
router
  .route('/users/:id/private')
  .authorize((ctx) => ctx.user.id === ctx.params.id)
  .get((ctx) => {
    ctx.response(userData);
  });
```

## Error Handling & Reliability

1. **Enhanced Error Handling**:
   - Structured error responses
   - Error classification (network, application, validation)
   - Rate limiting and backoff

2. **Connection Reliability**:
   - Smart reconnection with exponential backoff
   - Message queue for offline operation
   - Message deduplication

## Next Steps Implementation Details

1. **Core Package Implementation**:
   - Define all shared interfaces
   - Create the message protocol
   - Implement base strategy interfaces

2. **Neorest Client Package**:
   - Port existing client with improved API
   - Implement WebSocket and HTTP strategies
   - Add connection management improvements

3. **Router Core Implementation**:
   - Create abstract router base class
   - Implement route matching and subscription management
   - Define platform-agnostic interfaces

4. **Platform-Specific Routers**:
   - Implement Deno router with native APIs
   - Implement Node.js router with compatible libraries
   - Create adapter patterns for framework integration

5. **Examples and Documentation**:
   - Create full-stack examples
   - Document API and architecture
   - Provide migration guides
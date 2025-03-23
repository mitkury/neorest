# TypeScript Build Challenges in Monorepo Structure

## The Challenge

When making Neorest platform-agnostic, we encountered several TypeScript build challenges that are worth documenting:

1. **Class Inheritance Across Package Boundaries**: When extending base classes from another package (e.g., extending `ConnectionBase` from `@neorest/core` in `@neorest/router-core`), TypeScript struggles with protected members and method overrides.

2. **Declaration File Generation**: TypeScript has difficulty generating correct `.d.ts` files when there are complex inheritance patterns across package boundaries.

3. **Module Resolution Conflicts**: Different module resolution strategies (`Node`, `NodeNext`, `ESNext`) have different import requirements that conflict with each other.

4. **Project References**: TypeScript's project references system requires careful configuration to ensure packages build in the correct order.

## Potential Solutions

### 1. Favor Composition Over Inheritance

```typescript
// Instead of extending:
export class ServerConnection extends ConnectionBase { ... }

// Use composition:
export class ServerConnection {
  private connection: ConnectionBase;
  
  constructor(strategy: CommunicationStrategy) {
    this.connection = new ConnectionBase(strategy);
  }
  
  // Delegate methods as needed
}
```

### 2. Use Interfaces for Cross-Package Contracts

```typescript
// In core package:
export interface IConnectionBase {
  registerHandler(type: string, handler: MessageHandler): void;
  postAndForget(msgOrPromise: MsgType | Promise<MsgType>): Promise<void>;
  // Other methods...
}

export class ConnectionBase implements IConnectionBase { ... }

// In router-core package:
import { IConnectionBase } from '@neorest/core';

export class ServerConnection implements IConnectionBase { ... }
```

### 3. Flatten Package Structure

Consider merging related packages (e.g., core and router-core) to eliminate cross-package dependencies. This simplifies the build process at the cost of some modularity.

### 4. Use Modern Build Tools

Tools like [Turborepo](https://turbo.build/repo) or [NX](https://nx.dev/) offer better support for TypeScript monorepos by:
- Managing build order automatically
- Caching build outputs
- Providing consistent configuration

### 5. Consistent Module Resolution

Pick one module resolution strategy and stick with it across all packages:

```json
// In tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",       // Or "NodeNext"
    "moduleResolution": "node", // Or "NodeNext"
    // Ensure these are consistent across all package configs
  }
}
```

### 6. Explicit Public APIs

Make sure your public API is explicitly defined and consistently typed:

```typescript
// In package index.ts
export type { ConnectionBase } from './ConnectionBase';
export { type IConnectionBase } from './interfaces';
```

## Recommended Approach

For new projects, we recommend:

1. Define clear interface contracts between packages
2. Use composition over inheritance for cross-package dependencies
3. Adopt a modern build system like Turborepo
4. Consider the tradeoffs between modularity (multiple packages) vs. simplicity (fewer packages)

These approaches will help avoid the TypeScript build challenges we encountered while maintaining a clean, modular architecture.
# Neorest Package Restructuring Summary

## Overview

The Neorest package has been restructured to support multiple runtimes (Node.js, Deno, and browser) with separate endpoints using conditional exports, following the best practices outlined in the documentation.

## Changes Made

### 1. Package Structure

**Before**: Multiple separate packages
```
packages/
  core/           # Core types and interfaces
  router-core/    # Core router implementation
  router-node/    # Node.js specific router
  router-deno/    # Deno specific router
  neorest/        # Client implementation
  neorest-node/   # Node.js wrapper
```

**After**: Single consolidated package with runtime-specific directories
```
packages/neorest/
  src/
    core/         # Isomorphic code (types, base classes, utilities)
    node/         # Node.js specific adapters
    deno/         # Deno specific adapters
    browser/      # Browser specific code (if needed)
    Client.ts     # Client implementation
    ClientConnection.ts
    strategies/   # Communication strategies
    index.ts      # Main entry point (client-side)
```

### 2. Package.json Configuration

The main package now uses conditional exports to serve different runtimes:

```json
{
  "exports": {
    ".": {
      "browser": {
        "import": "./dist/index.browser.mjs",
        "require": "./dist/index.browser.cjs"
      },
      "deno": "./deno/mod.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.mjs"
    },
    "./node": {
      "import": "./dist/node.mjs",
      "require": "./dist/node.cjs"
    },
    "./browser": {
      "import": "./dist/index.browser.mjs",
      "require": "./dist/index.browser.cjs"
    },
    "./deno": "./deno/mod.ts",
    "./core": {
      "import": "./dist/core.mjs",
      "require": "./dist/core.cjs"
    }
  }
}
```

### 3. Build Configuration

Multiple tsup configurations for different targets:

- **tsup.config.ts**: Main build for Node.js (ESM + CJS)
- **tsup.browser.config.ts**: Browser-specific build
- **tsup.deno.config.ts**: Deno-specific build

### 4. Import Structure

**Client Usage**:
```typescript
// Browser/Node.js/Deno clients
import { Client } from 'neorest';
```

**Server Usage**:
```typescript
// Node.js server
import { NodeRouter } from 'neorest/node';

// Deno server
import { DenoRouter } from 'neorest/deno';

// Core types and utilities
import { Router, ServerConnection } from 'neorest/core';
```

## Benefits

1. **Simplified Maintenance**: Single package instead of multiple packages
2. **Runtime Isolation**: Each runtime gets only the code it needs
3. **Tree Shaking**: Bundlers can exclude unused runtime-specific code
4. **Better DX**: Clear import paths for different use cases
5. **Reduced Complexity**: No complex workspace dependencies

## Build Output

The build process generates:

- `dist/index.mjs/cjs` - Main client entry point
- `dist/index.browser.mjs/cjs` - Browser-specific client
- `dist/node.mjs/cjs` - Node.js server entry point
- `dist/core.mjs/cjs` - Core types and utilities
- `deno/mod.js` - Deno-specific entry point

## Migration Guide

### For Users

**Before**:
```typescript
import { Client } from '@neorest/neorest';
import { NodeRouter } from '@neorest/router-node';
```

**After**:
```typescript
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';
```

### For Developers

The source code is now organized by runtime concerns:
- Keep isomorphic code in `src/core/`
- Put Node.js specific code in `src/node/`
- Put Deno specific code in `src/deno/`
- Use relative imports within the package

## Testing

All entry points have been tested and verified to work correctly:
- ✅ Main entry point (client-side)
- ✅ Node.js entry point (server-side)
- ✅ Core entry point (types and utilities)
- ✅ Browser entry point (client-side)

## Next Steps

1. Update documentation and examples
2. Update tests to use new import paths
3. Consider adding TypeScript declaration files
4. Publish the new package structure
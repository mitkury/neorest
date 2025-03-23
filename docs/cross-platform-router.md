# Building a Cross-Platform Router

A guide to creating a JavaScript/TypeScript router that works seamlessly in both Node.js and Deno environments.

## Design Principles

1. **Runtime Agnostic Core**: Create a runtime-agnostic core router implementation
2. **Adapter Pattern**: Use adapters to bridge environment-specific APIs
3. **Common Interface**: Define clear interfaces that abstract away runtime differences
4. **Progressive Enhancement**: Support common features everywhere, with optional runtime-specific enhancements

## Architecture

```
├── src/
│   ├── core/           # Runtime-agnostic core functionality
│   │   ├── router.ts   # Main router implementation
│   │   └── types.ts    # Shared type definitions
│   ├── adapters/       # Runtime-specific adapters
│   │   ├── node.ts     # Node.js adapter
│   │   └── deno.ts     # Deno adapter
│   ├── utils/          # Utility functions
│   │   ├── runtime.ts  # Runtime detection
│   │   └── url.ts      # URL parsing utilities
│   └── mod.ts          # Main entry point
└── package.json        # npm package config
```

## Implementation Guide

### 1. Define Common Types

```typescript
// src/core/types.ts

export interface Request {
  method: string;
  url: string;
  headers: Record<string, string> | Headers;
  body?: ReadableStream<Uint8Array> | null;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export interface Response {
  status(code: number): Response;
  header(name: string, value: string): Response;
  type(contentType: string): Response;
  send(body: unknown): void;
  json(data: unknown): void;
}

export interface RouteHandler {
  (req: Request, res: Response): void | Promise<void>;
}

export interface RouterOptions {
  caseSensitive?: boolean;
  strict?: boolean;
  prefix?: string;
}
```

### 2. Create Runtime Detection Utilities

```typescript
// src/utils/runtime.ts

export const isNode = (): boolean => 
  typeof process !== 'undefined' && 
  process.versions != null && 
  process.versions.node != null;

export const isDeno = (): boolean => 
  typeof Deno !== 'undefined';

export const isBun = (): boolean =>
  typeof process !== 'undefined' && 
  typeof process.versions === 'object' && 
  process.versions.bun != null;
```

### 3. Implement Runtime-Specific Adapters

#### Node.js Adapter

```typescript
// src/adapters/node.ts

import type { IncomingMessage, ServerResponse } from 'http';
import type { Request, Response } from '../core/types';

export function createRequest(req: IncomingMessage): Request {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  
  return {
    method: req.method || 'GET',
    url: url.pathname,
    headers: req.headers as Record<string, string>,
    body: req.method !== 'GET' && req.method !== 'HEAD' 
      ? new ReadableStream({
          start(controller) {
            req.on('data', chunk => controller.enqueue(chunk));
            req.on('end', () => controller.close());
            req.on('error', err => controller.error(err));
          }
        })
      : null,
    query: Object.fromEntries(url.searchParams)
  };
}

export function createResponse(res: ServerResponse): Response {
  return {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    header(name: string, value: string) {
      res.setHeader(name, value);
      return this;
    },
    type(contentType: string) {
      res.setHeader('Content-Type', contentType);
      return this;
    },
    send(body: unknown) {
      if (typeof body === 'string') {
        res.end(body);
      } else if (Buffer.isBuffer(body)) {
        res.end(body);
      } else if (body instanceof Uint8Array) {
        res.end(Buffer.from(body));
      } else if (body === null || body === undefined) {
        res.end();
      } else {
        res.end(String(body));
      }
    },
    json(data: unknown) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    }
  };
}
```

#### Deno Adapter

```typescript
// src/adapters/deno.ts

import type { Request, Response } from '../core/types';

export function createRequest(req: Request): Request {
  const url = new URL(req.url);
  
  return {
    method: req.method,
    url: url.pathname,
    headers: req.headers,
    body: req.body,
    query: Object.fromEntries(url.searchParams)
  };
}

export function createResponse(): Response {
  const headers = new Headers();
  let statusCode = 200;
  let body: unknown;
  
  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    header(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    type(contentType: string) {
      headers.set('Content-Type', contentType);
      return this;
    },
    send(data: unknown) {
      body = data;
      return new Response(
        typeof data === 'string' || data instanceof Uint8Array 
          ? data 
          : String(data),
        { status: statusCode, headers }
      );
    },
    json(data: unknown) {
      headers.set('Content-Type', 'application/json');
      return new Response(
        JSON.stringify(data),
        { status: statusCode, headers }
      );
    }
  };
}
```

### 4. Implement Core Router

```typescript
// src/core/router.ts

import { RouteHandler, RouterOptions, Request, Response } from './types';

export class Router {
  private routes: Map<string, Map<string, RouteHandler>>;
  private options: Required<RouterOptions>;
  
  constructor(options: RouterOptions = {}) {
    this.routes = new Map();
    this.options = {
      caseSensitive: options.caseSensitive ?? false,
      strict: options.strict ?? false,
      prefix: options.prefix ?? '',
    };
  }
  
  get(path: string, handler: RouteHandler): Router {
    return this.addRoute('GET', path, handler);
  }
  
  post(path: string, handler: RouteHandler): Router {
    return this.addRoute('POST', path, handler);
  }
  
  put(path: string, handler: RouteHandler): Router {
    return this.addRoute('PUT', path, handler);
  }
  
  delete(path: string, handler: RouteHandler): Router {
    return this.addRoute('DELETE', path, handler);
  }
  
  private addRoute(method: string, path: string, handler: RouteHandler): Router {
    const normalizedPath = this.normalizePath(path);
    const methodMap = this.routes.get(normalizedPath) || new Map();
    
    methodMap.set(method, handler);
    this.routes.set(normalizedPath, methodMap);
    
    return this;
  }
  
  private normalizePath(path: string): string {
    let normalizedPath = path;
    
    // Apply prefix
    if (this.options.prefix) {
      normalizedPath = `${this.options.prefix}${normalizedPath}`;
    }
    
    // Apply case sensitivity
    if (!this.options.caseSensitive) {
      normalizedPath = normalizedPath.toLowerCase();
    }
    
    // Apply strictness (trailing slashes)
    if (!this.options.strict) {
      normalizedPath = normalizedPath.endsWith('/') 
        ? normalizedPath.slice(0, -1) 
        : normalizedPath;
    }
    
    return normalizedPath;
  }
  
  async handle(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.url);
    const methodMap = this.routes.get(path);
    
    if (!methodMap) {
      res.status(404).send('Not Found');
      return;
    }
    
    const handler = methodMap.get(req.method);
    
    if (!handler) {
      res.status(405).send('Method Not Allowed');
      return;
    }
    
    try {
      await handler(req, res);
    } catch (err) {
      console.error('Route handler error:', err);
      res.status(500).send('Internal Server Error');
    }
  }
}
```

### 5. Create Main Entry Point

```typescript
// src/mod.ts

import { Router } from './core/router';
import { isNode, isDeno } from './utils/runtime';
import type { Request, Response, RouteHandler, RouterOptions } from './core/types';

// Export types
export type { Request, Response, RouteHandler, RouterOptions };

// Export router
export { Router };

// Export environment-specific helpers
export async function createServer(router: Router, options: { port: number }) {
  if (isNode()) {
    const { createServer } = await import('http');
    const { createRequest, createResponse } = await import('./adapters/node');
    
    const server = createServer(async (req, res) => {
      const request = createRequest(req);
      const response = createResponse(res);
      await router.handle(request, response);
    });
    
    server.listen(options.port, () => {
      console.log(`Server running on http://localhost:${options.port}`);
    });
    
    return server;
  } else if (isDeno()) {
    const { createRequest, createResponse } = await import('./adapters/deno');
    
    const server = Deno.serve({ port: options.port }, async (req) => {
      const request = createRequest(req);
      const response = createResponse();
      return await router.handle(request, response);
    });
    
    console.log(`Server running on http://localhost:${options.port}`);
    
    return server;
  } else {
    throw new Error('Unsupported runtime environment');
  }
}
```

### 6. Configure Package for Both Environments

```json
// package.json
{
  "name": "cross-platform-router",
  "version": "1.0.0",
  "description": "A router that works in both Node.js and Deno",
  "main": "./dist/cjs/mod.js",
  "module": "./dist/esm/mod.js",
  "types": "./dist/types/mod.d.ts",
  "exports": {
    ".": {
      "import": "./dist/esm/mod.js",
      "require": "./dist/cjs/mod.js",
      "types": "./dist/types/mod.d.ts"
    }
  },
  "scripts": {
    "build": "npm run build:esm && npm run build:cjs && npm run build:types",
    "build:esm": "esbuild src/**/*.ts --format=esm --outdir=dist/esm",
    "build:cjs": "esbuild src/**/*.ts --format=cjs --outdir=dist/cjs",
    "build:types": "tsc --declaration --emitDeclarationOnly --outDir dist/types"
  },
  "files": [
    "dist/"
  ]
}
```

## Usage Examples

### Node.js Example

```javascript
// server.js
import { Router, createServer } from 'cross-platform-router';

const router = new Router();

router.get('/', (req, res) => {
  res.json({ message: 'Hello from Node.js!' });
});

router.post('/echo', async (req, res) => {
  const chunks = [];
  const reader = req.body.getReader();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const body = new TextDecoder().decode(
    chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  );
  
  res.json({ echo: body });
});

createServer(router, { port: 3000 });
```

### Deno Example

```typescript
// server.ts
import { Router, createServer } from 'https://esm.sh/cross-platform-router';

const router = new Router();

router.get('/', (req, res) => {
  res.json({ message: 'Hello from Deno!' });
});

router.post('/echo', async (req, res) => {
  const body = await req.body.text();
  res.json({ echo: body });
});

createServer(router, { port: 3000 });
```

## Advanced Features

### Middleware Support

```typescript
// Add to router.ts
type Middleware = (req: Request, res: Response, next: () => Promise<void>) => void | Promise<void>;

export class Router {
  // Existing code...
  private middlewares: Middleware[] = [];
  
  use(middleware: Middleware): Router {
    this.middlewares.push(middleware);
    return this;
  }
  
  async handle(req: Request, res: Response): Promise<void> {
    let index = 0;
    
    const next = async (): Promise<void> => {
      const middleware = this.middlewares[index++];
      if (middleware) {
        await middleware(req, res, next);
      } else {
        // Process route handlers after all middleware
        await this.processRoute(req, res);
      }
    };
    
    await next();
  }
  
  private async processRoute(req: Request, res: Response): Promise<void> {
    // Original route handling logic here
  }
}
```

### Path Parameters

```typescript
// Enhanced router with path parameters
export class Router {
  // Change routes structure
  private routes: Array<{
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
  }> = [];
  
  private addRoute(method: string, path: string, handler: RouteHandler): Router {
    const paramNames: string[] = [];
    const pattern = this.pathToRegExp(path, paramNames);
    
    this.routes.push({ method, pattern, paramNames, handler });
    return this;
  }
  
  private pathToRegExp(path: string, paramNames: string[]): RegExp {
    const pattern = path.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    
    return new RegExp(`^${pattern}$`);
  }
  
  async handle(req: Request, res: Response): Promise<void> {
    const path = this.normalizePath(req.url);
    
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      
      const match = path.match(route.pattern);
      if (!match) continue;
      
      // Extract path parameters
      req.params = {};
      const values = match.slice(1);
      for (let i = 0; i < route.paramNames.length; i++) {
        req.params[route.paramNames[i]] = values[i];
      }
      
      try {
        await route.handler(req, res);
      } catch (err) {
        console.error('Route handler error:', err);
        res.status(500).send('Internal Server Error');
      }
      
      return;
    }
    
    // No matching route found
    res.status(404).send('Not Found');
  }
}
```

## Best Practices

1. **Isomorphic Dependencies**: Use dependencies that work in both environments
2. **Feature Detection**: Test for API availability rather than runtime detection when possible
3. **Minimal API Surface**: Focus on core router functionality, letting adapters handle environment specifics
4. **Comprehensive Testing**: Test in both Node.js and Deno environments
5. **Documentation**: Document any runtime-specific behavior
6. **ESM First**: Use ESM modules as the primary format, with CJS support for Node.js

## Performance Considerations

1. **Lazy Loading**: Dynamically import runtime-specific modules only when needed
2. **Caching**: Cache compiled route patterns and handlers for better performance
3. **Minimal Abstractions**: Keep the adapter layer thin to minimize overhead

## Conclusion

Building a cross-platform router requires careful abstraction of environment-specific APIs. By using a combination of runtime detection, adapters, and a common interface, you can create a router that provides a consistent developer experience across Node.js and Deno, while taking advantage of each platform's strengths. 
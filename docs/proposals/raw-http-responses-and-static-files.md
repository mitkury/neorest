# Proposal: Raw HTTP Responses and Static File Hosting

## Problem

Neorest already exposes registered routes over regular HTTP, but the current Node adapter only supports JSON-shaped responses cleanly.

Current limits:

- `NodeServerAdapter` always does `res.end(JSON.stringify(body))`
- `Router.executeHttpRoute()` always returns `application/json`
- `RequestContext` has no response headers or raw body escape hatch
- there is no built-in static-file or SPA fallback helper

That means Neorest can route normal HTTP requests, but it is not yet a good host for:

- HTML pages
- JS and CSS assets
- images and other binary files
- single-page app fallback to `index.html`

## Goals

- keep the existing route model
- preserve the current JSON default for normal API handlers
- add an explicit raw HTTP response path for non-JSON responses
- make static-file hosting possible in the Node adapter
- support SPA fallback without forcing a separate server

## Non-Goals

- replacing a full framework like Express or Fastify
- adding template rendering
- making static-file hosting part of the browser client runtime
- changing Neorest transport endpoints under `/.neorest`

## Current State

Today the HTTP routing path is already there:

- `NodeServerAdapter.handleHttpRequest()` dispatches non-`/.neorest` requests into `Router.executeHttpRoute()`
- `Router.executeHttpRoute()` matches the route and runs the normal handler

But the response path is JSON-only:

- `packages/neorest/src/node/adapters/NodeServerAdapter.ts`
- `packages/neorest/src/core/Router.ts`
- `packages/neorest/src/core/types.ts`

So this is not an HTTP routing gap. It is a response-capability gap.

## Proposed Design

### 1. Keep JSON as the default

Existing handlers should keep working unchanged:

```ts
router.onGet('/ping', (ctx) => {
  ctx.response = 'pong';
});
```

If a handler only sets `ctx.response`, Neorest should preserve current behavior:

- status from `ctx.statusCode || 200`
- JSON body by default

This keeps the main API surface simple.

### 2. Add an explicit raw HTTP response escape hatch

Extend `RequestContext` with an optional raw HTTP response field.

Example shape:

```ts
type RawHttpResponse = {
  body: string | Uint8Array;
  status?: number;
  headers?: Record<string, string>;
};
```

And in the request context:

```ts
interface RequestContext {
  ...
  rawResponse?: RawHttpResponse;
}
```

Behavior:

- if `ctx.rawResponse` is present, it wins
- `NodeServerAdapter` writes headers and body directly without `JSON.stringify`
- if `ctx.rawResponse` is absent, keep the current JSON path

This is the smallest change that unlocks HTML, text, CSS, JS, and binary responses.

### 3. Return richer HTTP execution results from `Router.executeHttpRoute()`

Instead of always returning:

```ts
{ status, body, contentType }
```

return something closer to:

```ts
type HttpRouteResult = {
  status: number;
  body: string | Uint8Array | Payload;
  headers?: Record<string, string>;
  bodyMode: 'json' | 'raw';
};
```

Rules:

- normal `ctx.response` -> `bodyMode: 'json'`
- `ctx.rawResponse` -> `bodyMode: 'raw'`
- route errors can stay JSON by default

This keeps the core router generic while letting the Node adapter send real files.

### 4. Add a Node-only static file helper

Static-file serving is Node-specific and should stay in the Node entrypoint.

Suggested API:

```ts
router.serveStatic('/assets/:path(.*)', {
  rootDir: 'dist/assets',
});
```

or:

```ts
router.serveStatic({
  route: '/:path(.*)',
  rootDir: 'dist',
});
```

Behavior:

- resolve the requested file under `rootDir`
- reject path traversal
- if file exists, return `ctx.rawResponse`
- infer `Content-Type`
- optionally set cache headers

This helper can be implemented as a convenience wrapper around `onGet(...)` plus `ctx.rawResponse`.

### 5. Add SPA fallback support

Static hosting usually needs one more primitive: a fallback for unmatched browser paths.

Suggested API:

```ts
router.setHttpFallback((ctx) => {
  ctx.rawResponse = {
    body: indexHtmlBytes,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  };
});
```

or a convenience helper:

```ts
router.serveSpa({
  rootDir: 'dist',
  indexFile: 'index.html',
});
```

Recommended behavior:

- serve an existing static file if it exists
- otherwise, for `GET` requests outside `/.neorest`, return `index.html`
- keep API routes explicit so fallback does not mask real route mistakes

## Why this shape

This keeps Neorest explainable:

- route matching stays the same
- JSON APIs stay simple
- raw HTTP responses are explicit
- static-file support stays Node-only

It also avoids overloading `ctx.response` with too many meanings.

## Implementation Plan

1. Add `rawResponse` to `RequestContext`.
2. Update `Router.executeHttpRoute()` to return headers and a response mode.
3. Update `NodeServerAdapter` to send raw bytes or strings directly when requested.
4. Add a small Node static-file helper with path traversal protection and content-type inference.
5. Add optional HTTP fallback or SPA helper in the Node entrypoint.
6. Add docs and examples for API routes plus hosted frontend assets.

## Test Plan

- route returning normal JSON still works unchanged
- route returning `text/html` via `rawResponse` returns raw HTML, not JSON-encoded text
- route returning bytes serves an image or other binary fixture correctly
- static-file helper serves an existing file with the right content type
- static-file helper rejects `..` traversal
- SPA fallback returns `index.html` for unmatched browser paths
- `/.neorest` transport endpoints still behave exactly as before

## Risks

- adding raw response support can complicate the otherwise simple response path
- SPA fallback can hide mistakes if it is too greedy
- content-type inference and cache headers can grow scope if we try to make them too smart

The mitigation is to keep JSON as the default and make raw/static behavior opt-in.

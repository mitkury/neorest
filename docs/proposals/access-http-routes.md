# Proposal: Expose Neorest routes over plain HTTP by default

## Problem
Today, routes registered via `router.onGet('/ping', ...)` and friends are “virtual”: they are consumed through the Neorest protocol (WebSocket or HTTP long‑polling) and cannot be called directly by a browser or plain HTTP client. Hitting `/ping` in a browser returns the generic "Neorest server" message, not the route result.

We want a simple, zero‑config way for HTTP‑first servers (current Node setup with optional WebSocket) to serve these same routes over regular HTTP while keeping the existing real‑time protocol intact.

## Goals
- Zero‑config: enabled by default for HTTP‑capable servers (Node, later Deno).
- No ambiguity between protocol transport and regular HTTP routes.
- Consistent status codes and bodies for HTTP.
- Keep it simple and default-on; we can iterate rapidly since Neorest is still WIP.
- Minimal surface change and straightforward to implement.

## Non‑Goals
- Full framework features (middlewares, static files, templating). This is about exposing the existing route handlers over HTTP.
- Replacing Express/Fastify. Users may still use those if they need more.

## Summary of the approach
- Reserve a dedicated base path for the Neorest transport endpoints: `/.neorest`.
- Route all existing protocol traffic (handshake, send, poll) under `/.neorest`.
- Treat all other paths as “regular HTTP” and map them to the registered router routes by verb and path.
- Add a small router API to execute a route without a persistent connection.
- Return plain HTTP responses with proper status codes and JSON bodies by default.

This keeps concerns separate and avoids content‑type heuristics or collisions.

## HTTP routing behavior
- Match incoming HTTP request by method and path against the router’s registered `inRoutes`.
- Build a `RequestContext` similar to protocol invocations:
  - `params`: from the path matcher
  - `data`:
    - GET → parsed query object (key/value strings)
    - POST/DELETE → parsed JSON body (if invalid JSON → 400)
  - `headers`: request headers
  - `route`: full path string
  - `sender`: a synthetic “HTTP request” sender (see below)
- Invoke the same handler the protocol would.
- Map handler result to HTTP:
  - Success → status `ctx.statusCode || 200` and body equal to `ctx.response`.
  - Error → status `ctx.statusCode || 500` and body `{ error: ctx.error }`.
- Content type: if `ctx.response` is an object/array → `application/json`; if it is a string/number/boolean → `text/plain` for primitives, JSON for non‑string primitives. (Simplest default: always JSON.)
- CORS: preserve existing permissive `*` defaults unless configured otherwise.

## Transport segregation
- Existing HTTP long‑polling endpoints move under `/.neorest`:
  - `GET /.neorest` → handshake, returns `{ clientId }`.
  - `GET /.neorest?poll=true&clientId=...` → returns queued messages or 204.
  - `POST /.neorest?clientId=...` → send `MsgWrapper`; returns array of messages or 202.
- Node adapter will first check for the `/.neorest` prefix. If present, handle as transport; otherwise, attempt HTTP route dispatch as above.


## Router API changes
Add a new method to `neorest/core`:

```ts
// Proposed API
class Router {
  /** Execute a route by verb + path without a persistent connection. */
  executeHttpRoute(
    verb: 'GET' | 'POST' | 'DELETE',
    path: string,
    data: any,
    headers: Record<string, string>
  ): Promise<{ status: number; body: any; contentType?: string }>;
}
```

Implementation sketch:
- Internally reuse the same route matching used by `handleRouteMessage`.
- Build a `RequestContext` and call the registered handler.
- Return `{ status, body }` mapped from `ctx` as described above.

### Synthetic HTTP sender
Handlers sometimes pass `ctx.sender` to `router.broadcastPost(..., ctx.sender)` to exclude the sender. For HTTP‑originating requests there is no persistent connection. Options:
- Provide a lightweight `HttpRequestSender` that implements the minimal surface of `ServerConnection` but is not registered in `router.connections`. Passing it as `exceptConn` will not exclude any real connection (same as omitting), which is acceptable as a default. Later we can enhance except‑semantics if needed.
- Alternatively, make `ctx.sender` optional. This would be a wider type change; not required in the first cut.

We will start with the synthetic sender approach to avoid API churn.

## Node adapter changes (default‑on)
- `NodeServerAdapter.handleHttpRequest` flow:
  1. If path starts with `/.neorest`, handle transport (handshake/poll/post) exactly as today.
  2. Else, attempt `router.executeHttpRoute(req.method as Verb, url.pathname, bodyOrQuery, headers)`.
  3. If a route matched, write status + body and `Content-Type` (default `application/json`).
  4. If no route matched, return 404 `{ error: 'Not found' }`.
- Enabled by default. No user code changes required.

## Client changes
- Update HTTP strategy to use `/.neorest` for handshake/poll/send. Remove legacy root paths entirely.
- WebSocket remains unchanged.

## Examples
Server:
```ts
router
  .onGet('/ping', (ctx) => { ctx.response = 'pong'; })
  .onPost('/echo', (ctx) => { ctx.response = ctx.data; })
  .onDelete('/items/:id', (ctx) => { ctx.response = { deleted: ctx.params.id }; });
```

HTTP:
- `GET /ping` → 200 `"pong"`
- `POST /echo` body `{ "x": 1 }` → 200 `{ "x": 1 }`
- `DELETE /items/123` → 200 `{ "deleted": "123" }`
- Protocol transport remains under `/.neorest`.

## Alternatives considered
- Header/content‑type detection to distinguish transport vs regular HTTP on the same path: brittle and confusing.
- Query‑param switch (e.g., `?neorest=true`): harder to reason about, leaks concern into user URLs.
- Mount under `/api` or configurable prefix: adds setup burden; we want zero‑config.

## Behavior and decisions
- Response format: default `application/json`. String/primitive responses are JSON-serialized by default. We can add a future escape hatch to override.
- Middleware: existing router middleware (e.g., `withAuth`) works unchanged; HTTP routes use the same `RequestContext`.
- Auth: prefer `Authorization: Bearer <token>` (or custom headers). All request headers are passed through to `ctx.headers` for both plain HTTP routes and `/.neorest` transport.
- HTTP routes vs subscriptions: serve GET/POST over regular HTTP URLs; subscriptions/events use the transport (WebSocket preferred; HTTP long‑polling at `/.neorest` as fallback). No subscriptions over plain HTTP routes.
- Opt‑out: add `disableHttpRoutes?: boolean` on `NodeRouter`/adapter; default is enabled.

## Implementation plan
1. `neorest/core`: add `executeHttpRoute` and synthetic sender utility.
2. `neorest/node`: move transport to `/.neorest`; implement HTTP route dispatch; remove legacy root transport paths.
3. `neorest` client: switch to `/.neorest` endpoints.
4. Tests: add unit tests for plain HTTP GET/POST/DELETE, plus transport at `/.neorest`.
5. Docs: update architecture to reflect HTTP routing and transport path.

## Risks
- Broadcast "exclude sender" semantics differ for HTTP‑originating requests. We accept this as a reasonable default for now.
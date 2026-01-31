# TODO (v1: NodeJS + Browser production focus)

## Must-have for v1
- Core stability and API
  - Finalize public API in `neorest` client (no breaking changes after v1)
  - Add input validation and error messages for client methods
- HTTP + WebSocket parity
  - Ensure equivalent behavior for GET/POST/DELETE over both strategies
  - Backpressure and rate-limit handling on both sides
- Node server adapter
  - Graceful shutdown, connection draining
  - Configurable CORS
  - Configurable timeouts for HTTP long-polling
- Robust reconnection
  - Tested flows for client reconnect and resubscribe
  - Exponential backoff configurable
- Tests
  - Unit tests for core, client, router-node
  - WebSocket + HTTP unit flows (done)
  - Add coverage thresholds for CI
- Packaging
  - Ensure dist outputs (JS + d.ts + sourcemaps) in all packages
  - Tree-shakeable ESM builds
  - Mark `ws` as optional peer for server-only usage
- Docs
  - README quick-starts for Node+Browser
  - API reference for client and router

## Nice-to-have for v1
- Auth hooks (e.g., header-based, token refresh)
- Middlewares on server (logging, auth, rate-limit)
- Browser demo app (simple chat/sync)

## Post-v1
- Playwright E2E tests (packages/e2e-tests)
- Examples repo/templates
- Performance and load testing scripts
- Telemetry/metrics hooks
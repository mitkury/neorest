# Build Frustrations (Notes)

Brief notes on pitfalls we hit and the simpler path forward.

## What went wrong

- Editing dist outputs
  - Manually touching `dist/*` (e.g., adding `index.d.ts`) is brittle and hides real config issues.
  - Build artifacts must be disposable; source of truth should be `src/*` only.

- Mixed build tools and formats
  - `tsup` with ESM/CJS + DTS added complexity (TS6307 “file not listed”, export condition warnings).
  - Multiple formats increased surface area for errors without immediate value at this stage.

- Importing from dist in workspace
  - Cross-package imports pointed to `dist/` during dev/tests, causing type and resolution drift.
  - Better: use root `tsconfig.json` path aliases and import from `src/` within the monorepo.

- Environment coupling
  - Building Deno code with Node’s `tsc` caused `Deno` type errors.
  - Solution: keep Deno out of Node build (separate pipeline) until Deno support is addressed.

- Tests not first-class
  - Tests weren’t a workspace; they depended on `dist` or custom loaders ad‑hoc.
  - Running TS in Node was inconsistent (ts-node loader vs raw Node ESM).

- Protocol mismatches
  - HTTP client/server didn’t align (clientId handshake, polling arrays vs single message).
  - Led to confusing runtime behavior during integration attempts.

## What we’re doing instead

- Single build tool: `tsc -b`
  - Use TS project references; emit declarations where needed, avoid bundlers for now.

- Source-based imports in workspace
  - Rely on root `tsconfig.json` paths for `@neorest/*` → `packages/*/src`.
  - Only publish `dist` externally; don’t import it during dev/tests.

- Separate environments cleanly
  - Defer Deno builds/tests; focus on Node (browser↔Node path) first.

- Tests as a workspace
  - Add `tests/node-core` as a workspace with its own `package.json` and `tsconfig.json`.
  - Use `tsx` to run TS tests directly (simple, no custom loaders).

- ESM only (for now)
  - Keep packages ESM; avoid CJS dual-build until necessary.

- Align protocol early
  - Fix HTTP handshake (clientId), polling response shape, and reconnection design before writing more tests.

## Actionable checkpoints

- Build only leaf packages that run in environments:
  - Build browser client (`neorest`) and Node server (`@neorest/router-node`).
  - Do not build core libraries (`@neorest/core`, `@neorest/router-core`) — use source imports via root tsconfig paths during dev/tests.
- During tests, only the client/server packages are built; core libraries are always referenced from `src/`.
- Tests import from `src/` via path aliases; no `dist` in dev/tests.
- Keep configs minimal: ESM + `tsc -b` only where needed (clients/servers).
- Add minimal Node e2e test (WS and HTTP) using `tsx` runner.
- Defer Deno build/tests to a separate workflow later.



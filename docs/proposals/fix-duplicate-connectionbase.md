### Title
Consolidate ConnectionBase into a Single Source of Truth

### Problem statement
There are two separate `ConnectionBase.ts` implementations in the repo:

- `packages/core/src/ConnectionBase.ts` (part of `@neorest/core`)
- `packages/neorest/src/core/ConnectionBase.ts` (internal to `neorest`)

They have diverged in behavior and API, causing risks of inconsistent runtime behavior depending on which one gets imported/transitively bundled.

### Current divergence (examples, not exhaustive)
- Lifecycle cleanup:
  - `neorest` version tracks and clears a `rateLimitInterval` on `close()`; `core` version does not.
- API surface:
  - `postAndExpectResponse` is `public` in `neorest` and `protected` in `core`.
- Minor internal differences (e.g., additional fields and guards) that change semantics subtly.

Concrete references:
```12:18:packages/neorest/src/core/ConnectionBase.ts
protected rateLimitInterval: ReturnType<typeof setInterval> | null = null;
```

```94:100:packages/neorest/src/core/ConnectionBase.ts
public close(): void {
  this.clearClosingTimer();
  this.clearRateLimitInterval();
  this.strategy.disconnect();
}
```

```431:438:packages/neorest/src/core/ConnectionBase.ts
protected clearRateLimitInterval(): void {
  if (this.rateLimitInterval) {
    clearInterval(this.rateLimitInterval);
    this.rateLimitInterval = null;
  }
}
```

The above methods/fields are missing in `packages/core/src/ConnectionBase.ts`.

These differences can cause:
- Inconsistent rate‑limiting reset behavior across runtimes.
- Different subclassing possibilities and call sites depending on which `ConnectionBase` is used.
- Confusing type declarations and duplicated symbols exported from different packages.

### Impact
- Maintenance overhead: fixes/features must be duplicated and kept in sync.
- Bug surface area: subtle drift makes tests flaky and behavior environment‑dependent.
- Consumer confusion: both `@neorest/core` and `neorest/core` appear to offer the same primitive but behave differently.
- Bundle size and tree‑shaking: duplicate code increases payloads and can hinder DCE.

### Root cause
Historical package split and ongoing restructuring led to the base class being implemented in both the standalone `@neorest/core` package and inside the main `neorest` package, without a single source of truth.

### Goals
- Single source of truth for `ConnectionBase`.
- Identical behavior and types across all runtimes.
- Clear import path for internal and external consumers.
- No breaking changes for public API unless explicitly versioned.

### Non‑goals
- Large refactors to unrelated parts of router/strategies.
- Changing public protocol types.

### Options
1) Consolidate on `@neorest/core` as the canonical source
   - Move missing features from `neorest` version into `@neorest/core` (e.g., `rateLimitInterval`, `clearRateLimitInterval`, any additional guards)
   - Update `neorest` to import and re‑export from `@neorest/core`
   - Pros: Clear layering; core is reusable; smaller main package
   - Cons: Requires cross‑workspace build order and CI discipline

2) Consolidate inside `neorest` (deprecate `@neorest/core`)
   - Remove `packages/core` or reduce it to types-only re‑exports pointing to `neorest`
   - Pros: Fewer packages to coordinate
   - Cons: Loses clean separation; downstream users of `@neorest/core` must migrate

3) Split responsibilities strictly
   - Keep only pure types/interfaces in `@neorest/core`
   - Host the implementation of `ConnectionBase` exclusively in `neorest`
   - Pros: Minimal circular concerns
   - Cons: `@neorest/core` no longer provides a usable base class implementation

### Proposed direction
Adopt Option 1: make `@neorest/core` the single source of truth for `ConnectionBase` implementation and have `neorest` import/re‑export it. This matches the documented architecture, keeps base logic reusable across routers/runtimes, and reduces duplication.

High‑level steps:
- Port all enhancements from `neorest` version into `@neorest/core`:
  - Add `rateLimitInterval` and `clearRateLimitInterval()`; ensure `close()` clears it
  - Align visibility (`public` vs `protected`) where needed (decide and document)
  - Verify parity of handlers and error paths
- Replace `packages/neorest/src/core/ConnectionBase.ts` with a thin import/re‑export from `@neorest/core`, or remove it and fix imports
- Ensure `packages/neorest/src/core/index.ts` re‑exports `ConnectionBase` from `@neorest/core`
- Update path aliases and build to avoid duplicate bundles
- Run unit tests in all transports to confirm behavior parity

Detailed migration plan:
- Step 1: Port features
  - Add missing lifecycle handling to `packages/core/src/ConnectionBase.ts`
  - Ensure `setupRateLimiting()` mirrors the `neorest` behavior (stores interval handle)
- Step 2: Decide API visibility for `postAndExpectResponse`
  - If public API is required by consumers, keep it `public` and document; otherwise keep `protected`
- Step 3: Deprecate duplicate file
  - Replace `packages/neorest/src/core/ConnectionBase.ts` with an import shim or remove and fix imports
  - Search and update imports to use `@neorest/core` (or via `neorest/core` re‑export)
- Step 4: Build/test
  - Build all workspaces; run unit tests (HTTP, WS, Auto)
  - Inspect bundles to ensure single implementation is emitted
- Step 5: Documentation
  - Update `docs/architecture.md` and `README.md` to state canonical import path

### Backward compatibility
- If any visibility changes are breaking, bump minor/major as appropriate and provide a migration note.
- Maintain re‑exports so existing `import { ConnectionBase } from 'neorest/core'` continues to work.

### Import path implications
- Ensure `tsconfig.json` path aliases prefer the canonical source:
  - `"@neorest/core": ["packages/core/src"]`
  - `"neorest": ["packages/neorest/src"]`
- In `packages/neorest/package.json`, keep re‑export of core in `exports["./core"]` pointing to built core bundle, or re‑export symbols from `@neorest/core` in source `index.ts`.
- Confirm no file imports `packages/neorest/src/core/ConnectionBase` directly after consolidation.

### CI guard (to prevent regressions)
Add a simple CI step that fails the build if more than one `ConnectionBase.ts` exists:
```bash
set -euo pipefail
matches=$(git ls-files "**/ConnectionBase.ts" | wc -l | tr -d ' ')
if [ "$matches" -ne 1 ]; then
  echo "Expected exactly one ConnectionBase.ts, found $matches" >&2
  git ls-files "**/ConnectionBase.ts"
  exit 1
fi
```

Additionally, ensure imports reference the canonical package:
```bash
if rg -n "packages/neorest/src/core/ConnectionBase" --hidden --no-ignore -g '!node_modules' | grep .; then
  echo "Found direct source import of duplicated ConnectionBase. Use @neorest/core." >&2
  exit 1
fi
```

### Acceptance criteria
- There is exactly one implementation of `ConnectionBase` in the repo.
- All packages import the same implementation (verified via grep/CI check).
- HTTP, WebSocket, and Auto strategy tests pass with no regressions.
- Bundle contains a single `ConnectionBase` (confirmed via build inspection).

### Follow‑ups (optional)
- Add a lint/CI rule that fails on multiple `ConnectionBase.ts` implementations.
- Document the canonical import path in `README.md` and `docs/architecture.md`.

### Risk mitigation and testing matrix
- Run the existing test suite: `packages/tests` (HTTP routes, WS, auto fallback, auth/security, middleware)
- Manual smoke tests in playgrounds (`playground/simplest`, `playground/chat`) with both WS and HTTP‑only
- Verify reconnection, backoff, and subscription flows (since they rely on base connection behavior)
- Benchmark suite sanity run (optional) to detect performance regressions


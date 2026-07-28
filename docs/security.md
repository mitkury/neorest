### Neorest security model (current state)

This document summarizes how Neorest creates and maintains sessions, what can go wrong, and what to test and harden next.

## Session/connection model

- **Connection secret**: Each client generates a 32-byte hex `secret` on startup (`newConnectionSecret()`), unless one is already present in the connection URL.
- **Server-side registration**: The `Router` stores `ServerConnection` instances in `Router.connections[secret]`. The secret is the stable logical connection identifier on the server.
- **Transport strategies**:
  - HTTP long-polling under `/.neorest` maintains per-client transport state keyed by `clientId`. The logical Neorest session is still keyed by the connection `secret`.
  - WebSocket transport can pass `?secret=<hex>` in the URL. A disconnected
    session can reuse its `ServerConnection`; an active session cannot be
    replaced with the secret alone.
  - HTTP-to-WebSocket auto-upgrades also carry a short-lived, server-issued
    token tied to the HTTP handshake.
- **Handshake authentication**: `authenticateConnection` can validate native
  HTTP or WebSocket headers, including HttpOnly session cookies, before a
  connection is created. Returning `null` rejects the handshake.
- **Plain HTTP routes**: Handshake authentication does not cover independent
  plain HTTP route requests. Protect those with route middleware or disable
  them and let the embedding framework own its authenticated HTTP API.
- **Application identity**: The hook result is frozen on `ServerConnection`.
  Application code reads it with `getIdentity()`; protocol clients cannot set
  or replace it.
- **Subscription authorization**: `onAuthorizeSubscription` can reject
  registration before a listener is stored. `onValidateBroadcast` remains a
  second delivery-time check.
- **Rate limiting**: The Node adapter defaults to 600 Neorest HTTP requests per
  minute per remote address. The router defaults to 100 protocol messages per
  second per connection. The client retains its own 100 msg/s guardrail.

## Trust boundaries and assumptions

- Without `authenticateConnection`, the server trusts possession of the
  connection `secret` for reconnecting a session whose prior transport is no
  longer active.
- With handshake authentication enabled, reconnects must present the same
  application identity as the existing connection.
- Possession of a secret alone does not replace an active transport. The
  automatic HTTP-to-WebSocket replacement requires the server-issued handshake
  token.
- CORS defaults to `*` for backward compatibility. Cookie-authenticated
  deployments should configure an explicit origin with `credentials: true`;
  disallowed origins receive 403.

## Potential attack vectors

- **Reconnect secret theft**: A stolen secret can reconnect after the original
  transport has disconnected. Application authentication must still protect
  route data; the secret is not a user credential.
- **Secret fixation/override**: A malicious client could try to send
  `DATA_SET('secret', chosen)` to overwrite the mapping. The server rejects
  attempts to set `secret`.
- **Secret override attempts**: Clients should not be able to change the server-managed `secret` after connection creation. This is denied by `ServerConnection`.
- **Brute force secret**: Secrets are 32 random bytes hex-encoded (256 bits).
  Brute force is not feasible. Default server limits bound noisy attempts, but
  an internet-facing deployment should still enforce proxy-level limits.
- **Transport abuse**: HTTP requests, active logical connections, pending
  handshakes, protocol message rate, and payload sizes are bounded. Tune these
  defaults for the deployment and add shared limits at the edge when running
  multiple processes.
- **CORS/CSRF**: Explicit origin checking is required for cookie-authenticated
  apps. CORS does not replace normal authorization or CSRF protections for
  state-changing plain HTTP routes.

## Current mitigations

- High-entropy secret generation using crypto APIs with fallback. Primary paths use secure randomness when available.
- Client-side rate limiting at 100 msg/s reduces accidental floods from the client.
- Active sessions reject transport replacement by reconnect secret alone.
- Auto-upgrades use a short-lived server-issued token, and unknown HTTP
  `clientId` values are rejected.
- JSON and WebSocket payloads default to a 1 MiB limit.
- Empty HTTP polls are held instead of producing a 100 ms short-poll loop.
- Logical connections and pending handshakes default to a 10,000-entry cap.
- HTTP and protocol message rate limits are enabled by default.

## Gaps and recommended hardening

- Support signed, expiring reconnection tokens instead of a bare secret if
  sessions must survive longer or move across server processes.
- Store sessions, limits, and subscriptions in shared infrastructure when
  horizontal scaling is required; the built-in state is process-local.
- Apply application idempotency keys to writes that callers may retry after a
  timeout.

## What we will test

- Reconnecting a disconnected session with the correct `?secret=` moves the
  session to the new transport and continues to work.
- Reconnecting with a random `?secret=` does not attach to any existing session.
- Presenting another client’s secret while its transport is active is rejected.
- HTTP-to-WebSocket replacement requires the HTTP handshake upgrade token.
- Cookie-backed handshake identity is immutable and is required again on
  transport replacement.
- Unauthorized subscriptions receive 403 and do not install listeners.
- Configured origins are enforced for HTTP and WebSocket handshakes.
- HTTP and protocol message limits return 429.
- Empty fallback polls stay open until data or timeout.
- Client-side rate limit: attempting to send >100 messages in one second yields an error response locally.
- Secret properties: hex format, length 64 chars, high entropy heuristic (basic randomness sanity checks).

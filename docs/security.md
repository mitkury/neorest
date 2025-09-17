### Neorest security model (current state)

This document summarizes how Neorest creates and maintains sessions, what can go wrong, and what to test and harden next.

## Session/connection model

- **Connection secret**: Each client generates a 32-byte hex `secret` on startup (`newConnectionSecret()`), stores it in the client connection headers, and immediately sends it to the server via a `DATA_SET` message: `set('secret', <hex>)`.
- **Server-side registration**: The `Router` listens for this `DATA_SET` and registers the `ServerConnection` in `Router.connections[secret]`. The secret is used as the stable identifier for the connection on the server.
- **Transport strategies**:
  - HTTP long-polling under `/.neorest` maintains per-client state keyed by `clientId`. Messages are posted and polled; once the `secret` is set, the server maps that connection under `connections[secret]`.
  - WebSocket upgrade path allows passing `?secret=<hex>` in the WS URL. When upgrading, `Router.handleNewConnection` accepts an optional `reconnectSecret`; if provided and found, it replaces the old connection mapping with the new transport, preserving the secret.
- **Auth for routes**: There is no built-in authentication for transport. Route handlers can apply `withAuth(validateToken, handler)` to check `Authorization` header (Bearer tokens). Transport endpoints accept requests without authentication.
- **Rate limiting (client-side)**: `ConnectionBase` enforces a soft client-side limit of 100 messages/second. There is no server-side rate limit in the router/adapter right now.

## Trust boundaries and assumptions

- The server trusts any `DATA_SET('secret', ...)` arriving over an established transport as the client’s connection secret. There is no additional binding to network identity or HTTP cookie/session.
- Reconnection via WebSocket query `?secret=` trusts possession of the secret as proof of ownership. If an attacker learns someone’s secret, they can connect and take over that session mapping.
- HTTP transport endpoints expose permissive CORS (`Access-Control-Allow-Origin: *`) for both transport and route execution, facilitating cross-origin use but also enabling CSRF-like abuse if application routes rely on ambient credentials.

## Potential attack vectors

- **Secret hijacking**: If an attacker obtains the 32-byte hex secret (via XSS, logs, referer leakage, or browser history if embedded in URLs), they can connect with `?secret=` and replace the victim’s server connection. Messages intended for the victim would flow to the attacker.
- **Secret fixation/override**: A malicious client could try to send `DATA_SET('secret', chosen)` to overwrite mapping. Currently, the first `set('secret', ...)` after connection creation is used to register; later changes are not explicitly blocked.
- **Brute force secret**: Secrets are 32 random bytes hex-encoded (256 bits). Brute force is not feasible. Rate-limiting missing on the server could still allow noisy attempts to cause resource exhaustion.
- **Transport abuse**: No server-side rate limiting or per-IP controls; an attacker can spam POSTs to `/.neorest` or poll aggressively to consume server resources.
- **CORS/CSRF**: Since CORS is `*`, a third-party origin can issue requests to public routes. If route handlers rely on `Authorization` headers and the browser omits them cross-origin, it is fine; however, applications must not rely on cookies for auth here without CSRF protections.

## Current mitigations

- High-entropy secret generation using crypto APIs with fallback. Primary paths use secure randomness when available.
- Client-side rate limiting at 100 msg/s reduces accidental floods from the client.

## Gaps and recommended hardening

- Require the `secret` to be supplied at transport creation and verify early, rather than accepting arbitrary late `DATA_SET` messages. Optionally bind a server-generated nonce to the first transport.
- Disallow changing the `secret` after initial registration for a connection.
- Add optional server-side rate limiting per IP and per connection.
- Support signed reconnection tokens (short-lived, server-issued) instead of reusing the bare `secret` in the URL.
- Allow configuring CORS properly (not `*` in production) and expose a CSRF mitigation guide for cookie-based apps.

## What we will test

- Reconnecting with the correct `?secret=` moves the session to the new transport and continues to work.
- Reconnecting with a random `?secret=` does not attach to any existing session.
- Attempting to hijack an existing connection by using another client’s `secret` effectively takes over today (documenting risk), to be addressed by future mitigations.
- CORS headers are present on transport endpoints and regular routes as currently implemented.
- Client-side rate limit: attempting to send >100 messages in one second yields an error response locally.
- Secret properties: hex format, length 64 chars, high entropy heuristic (basic randomness sanity checks).


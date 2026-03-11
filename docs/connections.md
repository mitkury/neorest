# Connection Model

This document explains what a "connection" means in Neorest and what properties the system tries to preserve across transports.

## What a connection is

In Neorest, a connection is not just a socket. It is the server-side session object that:

- receives route requests
- owns route subscriptions
- stores per-connection headers/state
- survives transport replacement during reconnects

The concrete network transport can change while the logical connection stays the same.

## Identity

Each logical connection is identified by a high-entropy `secret`.

- On the client, `ClientConnection` creates a secret unless one is already present in the URL.
- On the server, `Router` stores active connections by that secret.
- When a new transport arrives with an existing secret, the router reuses the same `ServerConnection` object instead of creating a new logical connection.

That is why reconnects can preserve subscriptions and connection-scoped state.

## Transports

Neorest supports three client transport modes:

- `websocket`: direct WebSocket connection
- `http`: HTTP long-polling over `/.neorest`
- `auto`: connect over HTTP first, then try to upgrade to WebSocket

On Node.js, `NodeServerAdapter` exposes the transport endpoints under `/.neorest` and optionally accepts WebSocket upgrades.

## Lifecycle

The typical lifecycle is:

1. A client creates a transport and connects.
2. The server creates or looks up the logical connection for that transport.
3. Route requests and subscription messages flow through that connection.
4. If the transport drops unexpectedly, the client may reconnect with the same secret.
5. The server swaps the transport on the existing logical connection.

This is why Neorest treats transport replacement differently from a final close.

## Reconnect behavior

Client reconnect is best-effort and bounded:

- reconnect is enabled by default
- retries use backoff
- explicit `client.close()` stops reconnect attempts
- transport replacement should not trigger a second reconnect loop

When reconnect succeeds, the client keeps using the same logical session and restores its subscriptions.

## HTTP long-polling specifics

HTTP long-polling has an extra transport-local `clientId` used only for the polling channel:

- `GET /.neorest` returns `{ clientId }`
- `POST /.neorest?clientId=...` sends a protocol message
- `GET /.neorest?poll=true&clientId=...` polls queued messages

`clientId` identifies the HTTP polling transport. The connection `secret` identifies the logical Neorest session.

## What is connection-scoped

These properties belong to the logical connection, not to one specific socket:

- subscriptions
- connection secret
- server-side header/state attached to the connection
- pending server-side route listeners tied to that connection

## What plain HTTP routes are not

Regular HTTP routes such as `GET /ping` or `POST /messages` are not persistent connections.

They reuse the same route handlers, but they do not create a subscribed, reconnectable Neorest session by themselves. Live subscriptions and protocol traffic still go through `/.neorest` or WebSocket.

## General properties

At a high level, the system is designed around these properties:

- one logical route model for request/response and broadcasts
- transport choice is separate from route semantics
- reconnect should preserve session identity
- transport upgrade should be transparent to user code
- explicit shutdown should be final
- plain HTTP access and real-time transport can coexist on the same server

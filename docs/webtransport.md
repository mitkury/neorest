# Production WebTransport

Neorest treats WebTransport as one interchangeable carrier for the same route
protocol used over WebSocket and held HTTP. Route handlers, subscriptions,
authentication policy, and reconnect logic do not need to know which carrier
is active.

## Deployment shape

WebTransport runs over HTTP/3 and therefore needs UDP ingress. A Node HTTP or
SvelteKit server still owns the TCP HTTP/HTTPS listener and composes Neorest's
request and WebSocket handlers. The optional Neorest WebTransport host owns an
HTTP/3 UDP listener. TCP and UDP may use the same numeric port.

Set `webTransport.publicUrl` whenever the externally visible hostname or port
differs from the listener. The edge or load balancer must forward HTTP/3
traffic to that UDP port. A TCP-only reverse proxy cannot carry it.

The current Node provider requires Node.js 20 or newer and these optional
packages:

```bash
npm install @fails-components/webtransport \
  @fails-components/webtransport-transport-http3-quiche
```

They are optional peer dependencies so applications using only WebSocket and
HTTP do not install a native QUIC binary. The provider boundary is isolated in
the Node adapter; it can be replaced when a suitable native Node server API is
available.

## Authentication

The flow is deliberately split:

1. The browser sends `GET /.neorest` over ordinary HTTP. Same-origin HttpOnly
   cookies are included normally.
2. `authenticateConnection` validates that request and returns an immutable
   identity.
3. The server returns the advertised WebTransport URL and a random upgrade
   ticket that expires after 30 seconds.
4. The browser includes the ticket, client ID, and reconnect secret in the
   WebTransport URL.
5. The HTTP/3 listener consumes the ticket exactly once and binds the stored
   identity to the new transport.

The ticket is a transport-upgrade credential, not an application bearer token.
It is never accepted by route authorization. A ticket cannot change the
identity on an existing logical connection.

Current WebTransport API drafts also allow caller-supplied handshake headers,
and Neorest forwards advanced transport authentication data there when
available. WebTransport still uses Fetch credentials mode `omit`, so an
HttpOnly cookie is not automatically available on CONNECT; the bootstrap
ticket remains the portable cookie-session bridge.

Configure an exact CORS origin for cookie-authenticated applications. The
bootstrap enforces it, and the WebTransport listener checks the CONNECT Origin
header when present.

## Framing and limits

Neorest uses one reliable bidirectional stream. Every protocol envelope is:

```text
4-byte unsigned big-endian JSON length | UTF-8 JSON bytes
```

This framing is necessary because stream reads do not preserve message
boundaries. The implementation supports split and combined frames, rejects
invalid envelopes, and applies:

- a maximum frame size (1 MiB by default)
- a bounded queued-write budget (four frames by default)
- writable-stream backpressure
- bounded session and stream setup
- the existing per-connection protocol message rate limit

Application payloads remain JSON-shaped. Large binary objects should use object
storage or upload endpoints. Media tracks should use WebRTC.

## Client selection

The default client remains simple:

```ts
const api = new Client(location.origin, 'auto');
```

Auto mode starts with HTTP so authentication works everywhere, then tries:

1. WebTransport, only when the server advertises it and the runtime implements
   `globalThis.WebTransport`
2. WebSocket
3. held HTTP

Override the upgrade order when needed:

```ts
const api = new Client(location.origin, 'auto', {
  transports: ['websocket', 'webtransport'],
});
```

Do not remove WebSocket or held HTTP for an internet-facing browser
application. UDP can be blocked, HTTP/3 support varies by client and network,
and fallback is part of production reliability rather than a legacy path.

## TLS

Production should use a publicly trusted certificate matching
`webTransport.publicUrl`. `serverCertificateHashes` is useful for local
development with a short-lived self-signed certificate; browser rules limit
such certificates to a short validity period.

## Operational checks

Before enabling WebTransport in production, verify:

- HTTP/3/UDP reaches every intended region and load balancer
- the advertised public URL is externally reachable
- TLS renewal updates both the HTTPS and HTTP/3 listeners
- WebTransport, WebSocket, and HTTP fallback each pass the same route tests
- origin rejection and one-time ticket replay tests pass
- active transport, handshake failures, fallback frequency, RTT, and error
  rates are observable
- process-local sessions are acceptable or replaced by shared state where
  horizontal failover is required

# Neorest

Real-time routes on top of a REST-shaped API.

Neorest lets you keep one route model for request/response and live updates:

- `GET`, `POST`, `DELETE` on routes
- subscribe to the same routes for broadcasts
- WebTransport or WebSocket when available, held HTTP long-polling fallback
- plain HTTP access to registered server routes

## Install

```bash
npm install neorest
```

The Node server runtime requires Node.js 20 or newer. WebTransport server
support additionally requires the optional HTTP/3 provider:

```bash
npm install @fails-components/webtransport \
  @fails-components/webtransport-transport-http3-quiche
```

Server-terminated live routes additionally require a Node WebRTC runtime:

```bash
npm install @roamhq/wrtc
```

## Node.js server

```ts
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ port: 8080 });

router
  .onGet('/ping', (ctx) => {
    ctx.response = 'pong';
  })
  .onPost('/messages', (ctx) => {
    ctx.response = ctx.data;
    router.broadcast('/messages', { action: 'POST', data: ctx.data }, ctx.sender);
  });

await router.start();
```

## Client

```ts
import { Client } from 'neorest';

const client = new Client('http://localhost:8080', 'auto');
await client.connect();

const pong = await client.get<string>('/ping');

await client.subscribe('/messages', (event) => {
  console.log(event.action, event.data);
});

await client.post('/messages', { text: 'hello' });
```

## Live audio, video, and data

Live routes connect a browser to a WebRTC peer hosted by your Node server.
Neorest owns authenticated signaling, trickle ICE, ordering, reconnect delivery,
and peer lifecycle. Media and data-channel traffic flows over WebRTC rather
than through JSON routes.

```ts
import wrtc from '@roamhq/wrtc';

const router = new NodeRouter({
  port: 8080,
  webRtc: wrtc,
  connectionGracePeriodMs: 15_000,
});

router.onLive('/agents/:agentId/realtime', {
  authorize: ({ connection, params }) => {
    return agents.canRun(connection.getIdentity()?.id, params.agentId);
  },
  iceServers: async ({ connection }) => {
    return turn.issueCredentials(connection.getIdentity()?.id);
  },
  open: async ({ params, peer }) => {
    const agent = await agents.openRealtime(params.agentId);
    peer.onTrack((event) => agent.acceptTrack(event.track));
    peer.onDataChannel((channel) => agent.attachChannel(channel));
    const outputTrack = agent.createAudioOutputTrack();
    peer.addTrack(outputTrack);
  },
});
```

```ts
const call = await client.live(`/agents/${agentId}/realtime`, {
  audio: true,
  receive: { audio: true },
  data: {
    events: { ordered: true },
  },
});

call.onRemoteStream((stream) => {
  remoteAudio.srcObject = stream;
});
call.onStateChange((state) => console.log(state));

await call.leave();
```

Node has no built-in `RTCPeerConnection`, so the server injects a WebRTC runtime;
Neorest performs the negotiation around it. Relayed two-client calls are also
available explicitly through `router.onLiveRoom()`. See [docs/live.md](docs/live.md).

Client options support default request headers, request timeouts, and reconnect
policy:

```ts
const client = new Client('http://localhost:8080', 'auto', {
  timeout: 15_000,
  headers: { 'x-client-name': 'web' },
  reconnect: { maxAttempts: 10 },
  transports: ['webtransport', 'websocket'],
});

client.onConnectionChange((connected) => {
  if (connected) {
    // Refetch durable snapshots after a restored connection.
  }
});
```

`auto` starts with a regular authenticated HTTP handshake, then selects the
first advertised and available transport: WebTransport, WebSocket, and finally
held HTTP. Routes and subscriptions do not change when the transport changes.

## WebTransport

Enable the optional HTTP/3 listener with the same TLS certificate used by the
public endpoint:

```ts
import { readFileSync } from 'node:fs';
import { NodeRouter } from 'neorest/node';

const cert = readFileSync('/run/tls/fullchain.pem', 'utf8');
const key = readFileSync('/run/tls/privkey.pem', 'utf8');
const router = new NodeRouter({
  port: 443,
  ssl: { cert, key },
  webTransport: {
    // HTTP/3 is UDP. It may share the numeric port with HTTPS/TCP.
    port: 443,
    hostname: '0.0.0.0',
    publicUrl: 'https://api.example.com/.neorest',
    cert,
    privateKey: key,
  },
});
```

WebTransport does not automatically send cookies or HTTP authentication.
Neorest therefore authenticates the ordinary `GET /.neorest` bootstrap
(including same-origin HttpOnly cookies) and returns a short-lived, single-use
upgrade ticket. The immutable identity from that handshake is carried into the
HTTP/3 connection. This also works on browsers predating caller-supplied
WebTransport handshake headers.

The WebTransport listener is optional because it needs an HTTP/3 implementation
and UDP ingress. WebSocket and held HTTP remain supported fallbacks. See
[docs/webtransport.md](docs/webtransport.md) for deployment details.

## Plain HTTP routes

Registered routes are also available over regular HTTP by default:

```bash
curl http://localhost:8080/ping
curl -X POST http://localhost:8080/messages \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello"}'
```

Neorest transport endpoints live under `/.neorest`:

- `GET /.neorest` for handshake
- `GET /.neorest?poll=true&clientId=...` for polling
- `POST /.neorest?clientId=...` for sending protocol messages

Set `disableHttpRoutes: true` on `NodeRouter` to expose only the transport endpoints.
Set `maxRequestBodyBytes` to change the default 1 MiB JSON/WebSocket payload
limit.

## Existing Node or SvelteKit server

`createHandlers()` lets a host server compose Neorest without opening another
TCP listener:

```ts
import { createServer } from 'node:http';
import { handler as svelteKitHandler } from './build/handler.js';
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({ disableHttpRoutes: true });
const neorest = await router.createHandlers();

const server = createServer(async (req, res) => {
  if (await neorest.request(req, res)) return;
  svelteKitHandler(req, res);
});

server.on('upgrade', (req, socket, head) => {
  void neorest.upgrade(req, socket, head).then((handled) => {
    if (!handled) socket.destroy();
  });
});

server.listen(8080);
```

The host owns `server.listen()` and `server.close()`. If WebTransport is enabled,
Neorest additionally owns the configured HTTP/3/UDP listener. Call
`router.close()` to release all Neorest connections, listeners, and timers.

## Cookie sessions and subscriptions

Authenticate the native handshake once and bind a trusted, immutable identity
to the connection:

```ts
const router = new NodeRouter({
  cors: {
    origin: 'https://app.example.com',
    credentials: true,
  },
  authenticateConnection: async ({ headers }) => {
    const session = await auth.api.getSession({ headers });
    return session
      ? { id: session.user.id, sessionId: session.session.id }
      : null;
  },
});

router
  .onAuthorizeSubscription('/users/:userId/events', (connection, params) => {
    return connection.getIdentity()?.id === params.userId;
  })
  .onValidateBroadcast('/users/:userId/events', (connection, params) => {
    return connection.getIdentity()?.id === params.userId;
  });
```

Returning `null` from `authenticateConnection` rejects the HTTP bootstrap or
WebSocket handshake. Browsers send same-origin HttpOnly cookies automatically;
application code does not need to expose a session token to JavaScript.

`authenticateConnection` protects persistent Neorest transports. Plain HTTP
routes remain ordinary independent requests and must use route middleware (or
the host framework's authentication). Cookie-backed apps commonly set
`disableHttpRoutes: true` and keep plain HTTP handling in their framework.

The Node adapter also provides held long polling, configurable CORS, a default
1 MiB payload limit, 600 HTTP requests/minute per client address, and a default
100 protocol messages/second per connection. All limits are configurable.

## Workspace layout

- `packages/neorest`: published package
- `packages/tests`: Vitest coverage for HTTP, WebSocket, WebTransport, reconnect, auth, and route matching
- `packages/benchmark`: ad hoc benchmark scripts
- `packages/playground`: small demo apps

## Development

```bash
npm test
```

That builds `neorest` and runs the unit tests.

For a short explanation of how Neorest connections, transport upgrades, and
reconnects work, see [docs/connections.md](docs/connections.md).

For the proposed Sila2 app API and WebRTC voice boundary, see
[docs/sila2-integration.md](docs/sila2-integration.md).

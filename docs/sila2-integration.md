# Using Neorest in Sila2

## Recommendation

Neorest can now share Sila2's adapter-node server, authenticate the Better Auth
cookie handshake, and authorize subscriptions. It is suitable for richer
bidirectional app operations once the local Neorest changes are released.

Sila2's current SSE invalidation path is already small and correct, so migration
does not need to be immediate. Keep SSE until a Neorest route replaces a real
combination of REST write + invalidation behavior. Keep WebRTC as a separate,
session-scoped media transport.

```text
Sila browser
  -> Neorest GET/POST/DELETE + subscriptions
     (WebTransport -> WebSocket -> held HTTP)
  -> Sila workspace app server
  -> workspace/thread runtime

Sila browser
  -> Neorest signaling routes
  -> WebRTC audio + small data-channel events
  -> Sila realtime session
  -> AI voice provider + tools
```

This keeps one route model for ordinary app reads, writes, and updates without
trying to make JSON-over-WebSocket carry microphone audio.

## What to build first in Sila2

Sila2 is currently filesystem-first and its workspace runtime already owns
channel startup and per-thread serialization. The first app server should sit
beside that runtime. It should not let browser routes write thread files
directly.

Start with:

- `GET /status`
- `GET /me`
- `GET /threads`
- `GET /threads/:channel/:threadId`
- `POST /threads/:channel/:threadId/messages`
- subscriptions on `/threads` and `/threads/<channel>/<threadId>/events`

The message route should call the same threaded runtime used by Slack and
Telegram. A small internal event bus can publish committed thread events to
Neorest after the runtime persists them.

Use one same-origin adapter-node server:

- SvelteKit continues to own Better Auth and the existing `/api` routes.
- Neorest handles `/.neorest` on the same server.
- `NodeRouter.createHandlers()` supplies the HTTP and WebSocket-upgrade
  handlers; the custom adapter-node entrypoint falls back to SvelteKit for
  requests Neorest does not own.
- Start with `disableHttpRoutes: true` if SvelteKit should remain the only plain
  HTTP API. Neorest protocol routes still work through `/.neorest`.

## Minimal server shape

The important boundary is resolving the Better Auth session from the native
handshake headers and returning a stable user ID:

```js
import { NodeRouter } from "neorest/node";

export class WorkspaceAppServer {
  constructor({ workspace, publicOrigin, auth }) {
    this.workspace = workspace;
    this.router = new NodeRouter({
      disableHttpRoutes: true,
      maxRequestBodyBytes: 1024 * 1024,
      cors: {
        origin: publicOrigin,
        credentials: true,
      },
      authenticateConnection: async ({ headers }) => {
        const session = await auth.api.getSession({ headers });
        return session
          ? { id: session.user.id, sessionId: session.session.id }
          : null;
      },
    });

    this.router
      .onGet("/threads", async (ctx) => {
        const userId = ctx.sender.getIdentity().id;
        ctx.response = await workspace.listThreads(userId);
      })
      .onPost("/threads/:threadId/messages", async (ctx) => {
        const userId = ctx.sender.getIdentity().id;
        ctx.response = await workspace.handleAppMessage({
          userId,
          threadId: ctx.params.threadId,
          data: ctx.data,
        });
      })
      .onAuthorizeSubscription("/threads/:threadId/events", (connection, params) => {
        return workspace.canAccessThread(connection.getIdentity().id, params.threadId);
      })
      .onValidateBroadcast("/threads/:threadId/events", (connection, params) => {
        return workspace.canAccessThread(connection.getIdentity().id, params.threadId);
      });
  }
}
```

The returned connection identity is separate from client-controlled Neorest
headers and cannot change during reconnect or HTTP-to-WebSocket upgrade.
`onAuthorizeSubscription` rejects unauthorized registration; keeping
`onValidateBroadcast` as a second check protects delivery if workspace access
changes after subscription.

Compose this router with SvelteKit using `createHandlers()` as shown in the
README. The host owns the HTTP server lifecycle.

## Minimal browser shape

```ts
import { Client } from "neorest";

const api = new Client(location.origin, "auto", {
  timeout: 15_000,
  headers: { "x-sila-client": "web" },
});

const refreshThreads = async () => {
  const response = await api.get("/threads");
  if (response.error) throw new Error(response.error);
  threads = response.data;
};

api.onConnectionChange((connected) => {
  if (connected) void refreshThreads();
});

await api.connect();
await api.subscribe("/threads", () => void refreshThreads());
await refreshThreads();
```

No session token is exposed to client JavaScript. Same-origin HTTP requests and
WebSocket handshakes carry the Better Auth HttpOnly cookie automatically.
WebTransport uses a single-use upgrade ticket issued by that authenticated HTTP
bootstrap, so it inherits the same immutable Better Auth identity without
reading the cookie in JavaScript.

Treat subscriptions as invalidation or event delivery, not as the only copy of
durable state. On a restored connection, refetch the relevant snapshot. This
closes gaps caused by a browser sleeping, a process restart, or an expired
server-side reconnect window.

## WebRTC voice path

Use a server-terminated live route for Sila voice:

1. Create a durable Sila conversation/session.
2. Register `router.onLive('/sessions/:sessionId/realtime', ...)` and authorize
   it from the immutable Neorest connection identity.
3. Configure the injected Node WebRTC peer with assistant audio, inbound media
   handlers, and an ordered data channel.
4. Call `client.live()` with microphone audio and `receive.audio` enabled.
5. Distinguish WebRTC transport readiness from agent/provider readiness.
6. Let Neorest sequence trickle ICE and perform bounded browser ICE restarts.

The live route replaces ticket, offer, candidate, end-of-candidates, and
candidate-polling endpoints for Neorest clients. Applications can retain legacy
HTTP signaling temporarily for native clients that do not yet implement the
Neorest live wire protocol.

Production voice requirements learned from WorldAgents:

- STUN plus TURN, including TURN/TCP and TURN/TLS on port 443
- authenticated route authorization and bounded signaling attempts
- an 8-second grace window for transient WebRTC `disconnected` states
- separate transport and model readiness states
- selected candidate type, RTT, jitter, packet loss, bitrate, reconnect, and
  relay-usage telemetry
- microphone audio on a WebRTC track, not base64 chunks in Neorest messages
- assistant audio on a WebRTC track
- small transcripts, tool events, interrupts, readiness, and diagnostics on
  the data channel

Do not put general thread synchronization on the WebRTC data channel. It is
owned by one live voice session; Neorest remains the application transport.
WebTransport is a strong option for Neorest signaling, streamed agent progress,
cancellation, presence, and other server-mediated realtime events. It does not
replace WebRTC audio tracks or TURN.

## Neorest constraints that still matter

- In-memory sessions and subscriptions do not survive a server restart.
- Clients may need to retry writes after timeouts or reconnects, so Sila write
  routes need application idempotency keys.
- Built-in HTTP and connection limits are process-local. Keep edge/proxy limits
  for multi-process or internet-facing deployments.
- CORS defaults to `*` for compatibility; Sila2 must configure its exact public
  origin with credentials enabled.
- Route payloads are JSON-shaped; binary files should use dedicated upload
  endpoints or object storage.

## Suggested rollout

1. Add a read-only `/status`, `/me`, and `/threads` server in Sila2.
2. Add authenticated browser chat writes through `ThreadedChannelRuntime`.
3. Add an event bus after durable thread persistence and broadcast invalidation
   events.
4. Add the SvelteKit client and snapshot refresh on connection restoration.
5. Stabilize append-only thread events and idempotent message creation.
6. Add voice sessions with the WorldAgents WebRTC contract as a separate
   realtime module.
7. Enable WebTransport after the deployment path accepts HTTP/3/UDP, retaining
   WebSocket and held HTTP in the client preference list.

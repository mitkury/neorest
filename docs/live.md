# Live routes

Live routes are server-terminated WebRTC sessions using the normal Neorest
connection as their control plane. `LIVE` route messages carry join, leave,
SDP, and trickle-ICE signaling. After negotiation, media tracks and data
channels flow directly between the browser and Node WebRTC peer.

The application does not implement signaling endpoints, candidate polling,
message ordering, reconnect delivery, or peer shutdown. It configures what the
server does with the established media and data channels.

## Server

Node.js does not provide `RTCPeerConnection`, so install a WebRTC runtime and
give it to `NodeRouter`:

```bash
npm install @roamhq/wrtc
```

```ts
import wrtc from '@roamhq/wrtc';
import { NodeRouter } from 'neorest/node';

const router = new NodeRouter({
  port: 8080,
  webRtc: wrtc,
  connectionGracePeriodMs: 15_000,
  authenticateConnection: async ({ headers }) => {
    const session = await auth.api.getSession({ headers });
    return session ? { id: session.user.id } : null;
  },
});

router.onLive('/sessions/:sessionId/realtime', {
  authorize: async ({ connection, params }) => {
    const allowed = await sessions.canAccess(
      connection.getIdentity()?.id,
      params.sessionId,
    );
    return allowed
      ? true
      : { allowed: false, status: 403, error: 'Session access denied' };
  },

  iceServers: ({ connection }) => {
    return turn.issueCredentials(connection.getIdentity()?.id);
  },

  open: async ({ params, peer }) => {
    const runtime = await agents.openRealtime(params.sessionId);

    peer.onTrack((event) => {
      if (event.track.kind === 'audio') runtime.attachMicrophone(event.track);
      if (event.track.kind === 'video') runtime.attachCamera(event.track);
    });

    peer.onDataChannel((channel) => {
      if (channel.label === 'events') runtime.attachEvents(channel);
    });

    // The application creates provider-specific media sources. Neorest adds
    // their tracks to the server peer before answering the browser offer.
    peer.addTrack(runtime.createAssistantAudioTrack());
  },

  onClose: ({ params, reason }) => {
    agents.detachRealtime(params.sessionId, reason);
  },
});

await router.start();
```

`webRtc` is a structural provider boundary. An application may instead pass
`createLivePeerConnection` when it needs custom construction, port ranges, or
provider instrumentation:

```ts
const router = new NodeRouter({
  createLivePeerConnection: (configuration) => {
    return new wrtc.RTCPeerConnection({
      ...configuration,
      portRange: { min: 40_000, max: 65_535 },
    });
  },
});
```

Neorest owns the returned peer connection's SDP, ICE, connection-state, and
shutdown handlers. Use the `peer` methods in `open` for application media and
data. `peer.connection` is an advanced escape hatch for provider-specific
operations and telemetry; applications should not replace Neorest's signaling
or connection-state handlers.

## Browser

```ts
import { Client } from 'neorest';

const client = new Client('https://api.example.com', 'auto');
await client.connect();

const session = await client.live(`/sessions/${sessionId}/realtime`, {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  receive: { audio: true },
  data: {
    events: { ordered: true },
  },
});

session.onRemoteStream((stream) => {
  remoteAudio.srcObject = stream;
});

session.onDataChannel((label, channel) => {
  if (label === 'events') {
    channel.addEventListener('message', handleAgentEvent);
  }
});

session.onStateChange((state) => {
  // connecting, connected, reconnecting, failed, closed
  console.log(state);
});
```

The live route authenticates and authorizes the join before the browser asks
for media permission. The server then waits up to `offerTimeoutMs` (60 seconds
by default) for capture and offer creation.

An application can capture or compose media itself:

```ts
const stream = new MediaStream([microphoneTrack, cameraTrack]);
const session = await client.live(`/sessions/${sessionId}/realtime`, {
  stream,
  receive: { audio: true },
  data: { events: { ordered: true } },
});
```

Application-owned tracks are not stopped by `leave()` unless
`stopLocalTracksOnLeave: true` is set. Tracks captured by Neorest are stopped
by default.

To change an established visual or audio source without renegotiation:

```ts
await session.replaceTrack(previousCameraTrack, nextCameraTrack);
```

## Lifecycle

- One authenticated logical Neorest connection owns the live session for a
  concrete route path.
- The server creates and configures its WebRTC peer before the browser is
  prompted for media.
- The browser is always the offerer. This makes browser permissions and
  receive-only transceivers part of the initial offer and gives the browser
  responsibility for bounded ICE restarts.
- SDP, candidates, and end-of-candidates messages are ordered by attempt and
  sequence number through normal Neorest request/response handling.
- Targeted server signals wait for a disconnected logical connection to
  replace its transport instead of being dropped.
- A dropped Neorest transport does not close healthy WebRTC during
  `connectionGracePeriodMs`.
- A transient WebRTC disconnect gets an 8-second grace period by default.
  The browser can then send a restart offer; unresolved recovery closes the
  server peer after `negotiationTimeoutMs`.
- Explicit `leave()` closes both peers and invokes the server `onClose` hook.

`getStats()` exposes the browser's `RTCStatsReport`. Server telemetry is
available from `peer.getStats()` or the injected provider.

Production deployments normally need short-lived TURN credentials, including
TURN/TCP or TURN/TLS reachable on port 443. WebTransport is not required for
live routes; WebSocket and held HTTP carry the same signaling protocol.

## Testing live audio

The repository includes a real-WebRTC loopback benchmark that runs directly on
macOS, Linux, and Windows and an optional Docker network-emulation wrapper:

```bash
npm run test:live-audio
npm run test:live-audio -- --profile degraded --runs 3
NETWORK_PROFILE=mobile npm run test:live-audio:network
```

The portable runner sends and records tracks independently in both directions,
then reports setup latency, data-channel RTT, approximate one-way audio latency,
correlation, dropouts, and WebRTC stats. The Docker runner additionally applies
packet delay, jitter, loss, and rate limits to signaling and media. See
[`packages/benchmark/README.md`](../packages/benchmark/README.md#live-audio-loopback)
for profiles and artifacts.

## Client-to-client rooms

Relayed one-to-one peer calls are the secondary topology and are explicit:

```ts
router.onLiveRoom('/calls/:callId', {
  authorize: ({ connection, params }) => {
    return calls.canJoin(connection.getIdentity()?.id, params.callId);
  },
  iceServers: ({ connection }) => {
    return turn.issueCredentials(connection.getIdentity()?.id);
  },
});
```

Both clients still call `client.live('/calls/id', options)`. The first waits;
the second participant creates the offer. Media bypasses the Neorest server.

The peer-room API currently supports exactly two participants. Group media
requires an SFU rather than routing media through Neorest JSON messages.

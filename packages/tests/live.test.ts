import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';
import { portManager } from './utils/portManager';

class FakeDataChannel extends EventTarget {
  public readyState: RTCDataChannelState = 'open';
  public bufferedAmount = 0;

  constructor(
    public readonly label: string,
    public readonly options: RTCDataChannelInit = {},
  ) {
    super();
  }

  send(): void {}

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}

class FakeMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    const index = this.tracks.indexOf(track);
    if (index >= 0) this.tracks.splice(index, 1);
  }
}

class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];

  public localDescription: RTCSessionDescription | null = null;
  public remoteDescription: RTCSessionDescription | null = null;
  public connectionState: RTCPeerConnectionState = 'new';
  public iceConnectionState: RTCIceConnectionState = 'new';
  public iceGatheringState: RTCIceGatheringState = 'new';
  public signalingState: RTCSignalingState = 'stable';
  public readonly candidates: Array<RTCIceCandidateInit | null> = [];
  public readonly channels: FakeDataChannel[] = [];
  public readonly transceivers: Array<{
    kind: string;
    init?: RTCRtpTransceiverInit;
  }> = [];
  public readonly senders: RTCRtpSender[] = [];
  public offerCount = 0;

  constructor(public readonly configuration: RTCConfiguration) {
    super();
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: MediaStreamTrack): RTCRtpSender {
    const sender: {
      track: MediaStreamTrack | null;
      replaceTrack(replacement: MediaStreamTrack | null): Promise<void>;
    } = {
      track,
      replaceTrack: async (replacement: MediaStreamTrack | null) => {
        sender.track = replacement;
      },
    };
    this.senders.push(sender as unknown as RTCRtpSender);
    return sender as unknown as RTCRtpSender;
  }

  addTransceiver(
    trackOrKind: MediaStreamTrack | string,
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    this.transceivers.push({
      kind: typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind,
      init,
    });
    return {} as RTCRtpTransceiver;
  }

  getSenders(): RTCRtpSender[] {
    return [...this.senders];
  }

  createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    const channel = new FakeDataChannel(label, options);
    this.channels.push(channel);
    return channel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.offerCount++;
    return {
      type: 'offer',
      sdp: `offer-${FakePeerConnection.instances.indexOf(this)}-${this.offerCount}`,
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: `answer-${FakePeerConnection.instances.indexOf(this)}` };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    queueMicrotask(() => {
      this.emit('icecandidate', {
        candidate: {
          candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'test',
          toJSON() {
            return {
              candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host',
              sdpMid: '0',
              sdpMLineIndex: 0,
              usernameFragment: 'test',
            };
          },
        },
      });
      this.emit('icecandidate', { candidate: null });
    });
    if (description.type === 'answer') queueMicrotask(() => this.connect());
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    if (description.type === 'answer') queueMicrotask(() => this.connect());
  }

  async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    this.candidates.push(candidate);
  }

  close(): void {
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
  }

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }

  private connect(): void {
    if (this.connectionState === 'closed') return;
    this.connectionState = 'connected';
    this.iceConnectionState = 'connected';
    this.emit('connectionstatechange');
    this.emit('iceconnectionstatechange');
  }

  private emit(type: string, values: Record<string, unknown> = {}): void {
    const event = new Event(type);
    Object.assign(event, values);
    const propertyHandler = (this as unknown as Record<string, unknown>)[`on${type}`];
    if (typeof propertyHandler === 'function') {
      (propertyHandler as (event: Event) => void)(event);
    }
    this.dispatchEvent(event);
  }
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for live state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('live routes', () => {
  const originalPeerConnection = globalThis.RTCPeerConnection;
  const originalMediaStream = globalThis.MediaStream;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let server: NodeRouter;
  const clients: Client[] = [];
  let mediaCaptureRequests = 0;

  beforeEach(async () => {
    FakePeerConnection.instances = [];
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: FakePeerConnection,
    });
    Object.defineProperty(globalThis, 'MediaStream', {
      configurable: true,
      value: FakeMediaStream,
    });
    mediaCaptureRequests = 0;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => {
            mediaCaptureRequests++;
            return new FakeMediaStream();
          },
        },
      },
    });
    const port = await portManager.getNextPort();
    server = new NodeRouter({
      port,
      connectionGracePeriodMs: 3_000,
      webRtc: {
        RTCPeerConnection: FakePeerConnection as unknown as new (
          configuration?: RTCConfiguration,
        ) => object,
      },
    });
    (server as NodeRouter & { testPort: number }).testPort = port;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await server.close();
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: originalPeerConnection,
    });
    Object.defineProperty(globalThis, 'MediaStream', {
      configurable: true,
      value: originalMediaStream,
    });
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  });

  it('negotiates the default live route with a server WebRTC peer', async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const closePeerStates: RTCPeerConnectionState[] = [];
    server.onPost('/agents/:agentId/realtime', (context) => {
      context.response = { ordinary: true };
    }).onLive('/agents/:agentId/realtime', {
      authorize: ({ params }) => params.agentId === 'guide',
      iceServers: [{ urls: 'turn:turn.example.test', username: 'user', credential: 'secret' }],
      open: ({ params, peer }) => {
        opened.push(params.agentId);
        peer.addTransceiver('audio', { direction: 'sendonly' });
      },
      onClose: ({ reason, peer }) => {
        closed.push(reason);
        closePeerStates.push(peer.connection.connectionState);
      },
      negotiationTimeoutMs: 1_000,
    });
    await server.listen();

    const port = (server as NodeRouter & { testPort: number }).testPort;
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    const otherClient = new Client(`ws://localhost:${port}`, 'websocket');
    clients.push(client, otherClient);
    await Promise.all([client.connect(), otherClient.connect()]);

    await expect(client.live('/agents/forbidden/realtime', {
      audio: true,
    })).rejects.toThrow(/403.*forbidden/i);
    expect(mediaCaptureRequests).toBe(0);

    const ordinary = await client.post<{ ordinary: boolean }>('/agents/guide/realtime');
    expect(ordinary.data.ordinary).toBe(true);

    const live = await client.live('/agents/guide/realtime', {
      receive: { audio: true },
      data: { 'worldagents-events': { ordered: true } },
      negotiationTimeoutMs: 1_000,
    });
    await waitFor(() => live.state === 'connected');

    expect(opened).toEqual(['guide']);
    expect(live.peerId).toBeTruthy();
    expect(FakePeerConnection.instances).toHaveLength(2);
    const [serverPeer, browserPeer] = FakePeerConnection.instances;
    expect(serverPeer.configuration.iceServers).toEqual([
      { urls: 'turn:turn.example.test', username: 'user', credential: 'secret' },
    ]);
    expect(serverPeer.transceivers).toEqual([
      { kind: 'audio', init: { direction: 'sendonly' } },
    ]);
    expect(browserPeer.transceivers).toEqual([
      { kind: 'audio', init: { direction: 'recvonly' } },
    ]);
    expect(serverPeer.remoteDescription?.type).toBe('offer');
    expect(browserPeer.remoteDescription?.type).toBe('answer');
    await waitFor(() => serverPeer.candidates.length >= 2 && browserPeer.candidates.length >= 2);

    await expect(otherClient.live('/agents/guide/realtime', {
      data: { events: { ordered: true } },
    })).rejects.toThrow(/409.*already active/i);

    await live.leave();
    await waitFor(() => closed.includes('left'));
    expect(closePeerStates).toEqual(['connected']);
  });

  it('negotiates a one-to-one room over normal route messages', async () => {
    const joined: string[] = [];
    const left: string[] = [];
    server.onPost('/calls/:callId', (context) => {
      context.response = { callId: context.params.callId, data: context.data };
    }).onLiveRoom('/calls/:callId', {
      authorize: ({ params }) => params.callId === 'demo',
      iceServers: [{
        urls: ['stun:stun.example.test', 'turn:turn.example.test'],
        username: 'short-lived-user',
        credential: 'short-lived-secret',
      }],
      onJoin: ({ participantId }) => { joined.push(participantId); },
      onLeave: ({ participantId }) => { left.push(participantId); },
    });
    await server.listen();

    const port = (server as NodeRouter & { testPort: number }).testPort;
    const firstClient = new Client(`ws://localhost:${port}`, 'websocket');
    const secondClient = new Client(`ws://localhost:${port}`, 'websocket');
    clients.push(firstClient, secondClient);
    await Promise.all([firstClient.connect(), secondClient.connect()]);

    const ordinaryResponse = await firstClient.post<{ callId: string }>('/calls/demo', { ping: true });
    expect(ordinaryResponse.data.callId).toBe('demo');

    const first = await firstClient.live('/calls/demo', {
      data: { events: { ordered: false, maxRetransmits: 0 } },
      negotiationTimeoutMs: 1000,
    });
    expect(first.state).toBe('waiting');

    const second = await secondClient.live('/calls/demo', {
      data: { events: { ordered: false, maxRetransmits: 0 } },
      negotiationTimeoutMs: 1000,
    });
    await waitFor(() => first.state === 'connected' && second.state === 'connected');

    expect(first.peerId).toBe(second.participantId);
    expect(second.peerId).toBe(first.participantId);
    expect(second.getDataChannel('events')).toBeDefined();
    expect(joined).toEqual([first.participantId, second.participantId]);
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(FakePeerConnection.instances[0].configuration.iceServers).toEqual([
      {
        urls: ['stun:stun.example.test', 'turn:turn.example.test'],
        username: 'short-lived-user',
        credential: 'short-lived-secret',
      },
    ]);
    await waitFor(() => FakePeerConnection.instances.every((peer) => peer.candidates.length >= 2));
    expect(FakePeerConnection.instances.every((peer) => peer.candidates.length === 2)).toBe(true);

    const offererPeer = (second as any).peerConnectionValue as FakePeerConnection;
    const offersBeforeFailure = offererPeer.offerCount;
    offererPeer.connectionState = 'failed';
    (offererPeer as any).emit('connectionstatechange');
    offererPeer.iceConnectionState = 'failed';
    (offererPeer as any).emit('iceconnectionstatechange');
    await waitFor(() => offererPeer.offerCount === offersBeforeFailure + 1);
    expect(offererPeer.offerCount).toBe(offersBeforeFailure + 1);

    await second.leave();
    await waitFor(() => first.state === 'waiting' && left.includes(second.participantId));
    expect(first.peerId).toBeNull();
  });

  it('enforces authorization and the one-to-one room limit', async () => {
    server.onLiveRoom('/calls/:callId', {
      authorize: ({ params }) => params.callId !== 'forbidden',
    });
    await server.listen();
    const port = (server as NodeRouter & { testPort: number }).testPort;

    const firstClient = new Client(`ws://localhost:${port}`, 'websocket');
    const secondClient = new Client(`ws://localhost:${port}`, 'websocket');
    const thirdClient = new Client(`ws://localhost:${port}`, 'websocket');
    clients.push(firstClient, secondClient, thirdClient);
    await Promise.all([firstClient.connect(), secondClient.connect(), thirdClient.connect()]);

    await expect(firstClient.live('/calls/empty')).rejects.toThrow(/requires media/i);
    await expect(firstClient.live('/calls/forbidden', { audio: true })).rejects.toThrow(/403.*forbidden/i);
    expect(mediaCaptureRequests).toBe(0);

    const mediaSession = await firstClient.live('/calls/media', { audio: true });
    expect(mediaCaptureRequests).toBe(1);
    await mediaSession.leave();

    const dataOnly = { data: { events: { ordered: true } } };
    const first = await firstClient.live('/calls/full', dataOnly);
    const second = await secondClient.live('/calls/full', dataOnly);
    await waitFor(() => first.state === 'connected' && second.state === 'connected');
    await expect(thirdClient.live('/calls/full', dataOnly)).rejects.toThrow(/409.*full/i);
  });

  it('fails clearly when a Node server has no WebRTC provider', async () => {
    await server.close();
    const port = await portManager.getNextPort();
    server = new NodeRouter({ port });
    server.onLive('/agents/:agentId/realtime');
    await server.start();

    const client = new Client(`ws://localhost:${port}`, 'websocket');
    clients.push(client);
    await client.connect();

    await expect(client.live('/agents/guide/realtime', {
      data: { events: { ordered: true } },
    })).rejects.toThrow(/501.*createLivePeerConnection/i);
    expect(mediaCaptureRequests).toBe(0);
  });

  it('replaces app-provided tracks and stops only tracks explicitly owned by the session', async () => {
    server.onLive('/media/:name');
    await server.listen();
    const port = (server as NodeRouter & { testPort: number }).testPort;
    const client = new Client(`ws://localhost:${port}`, 'websocket');
    clients.push(client);
    await client.connect();

    const appTrack = {
      kind: 'audio',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const appStream = new FakeMediaStream([appTrack]) as unknown as MediaStream;
    const appOwnedSession = await client.live('/media/app-owned', { stream: appStream });
    await waitFor(() => appOwnedSession.state === 'connected');
    await appOwnedSession.leave();
    expect(appTrack.stop).not.toHaveBeenCalled();

    const originalTrack = {
      kind: 'audio',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const replacementTrack = {
      kind: 'audio',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const wrongKindTrack = {
      kind: 'video',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const managedStream = new FakeMediaStream([originalTrack]) as unknown as MediaStream;
    const managedSession = await client.live('/media/managed', {
      stream: managedStream,
      stopLocalTracksOnLeave: true,
    });
    await waitFor(() => managedSession.state === 'connected');

    await expect(managedSession.replaceTrack(originalTrack, wrongKindTrack)).rejects.toThrow(
      /same media kind/i,
    );
    await managedSession.replaceTrack(originalTrack, replacementTrack);
    expect(managedStream.getTracks()).toEqual([replacementTrack]);

    await managedSession.leave();
    expect(originalTrack.stop).not.toHaveBeenCalled();
    expect(replacementTrack.stop).toHaveBeenCalledOnce();
  });

  it('keeps the peer connection alive while Neorest replaces its transport', async () => {
    server.onLiveRoom('/calls/:callId');
    await server.listen();
    const port = (server as NodeRouter & { testPort: number }).testPort;

    const firstClient = new Client(`ws://localhost:${port}`, 'websocket', {
      reconnect: { initialDelay: 500, maxDelay: 500, maxAttempts: 5 },
    });
    const secondClient = new Client(`ws://localhost:${port}`, 'websocket');
    clients.push(firstClient, secondClient);
    await Promise.all([firstClient.connect(), secondClient.connect()]);

    const [first, second] = await Promise.all([
      firstClient.live('/calls/reconnect', { data: { events: { ordered: true } } }),
      secondClient.live('/calls/reconnect', { data: { events: { ordered: true } } }),
    ]);
    await waitFor(() => first.state === 'connected' && second.state === 'connected');
    const connectionChanges: boolean[] = [];
    const removeListener = firstClient.onConnectionChange((connected) => {
      connectionChanges.push(connected);
    });

    const socket = (firstClient as any).conn.transport.socket;
    socket.close();
    await waitFor(() => connectionChanges.includes(false));

    const firstPeer = (first as any).peerConnectionValue as FakePeerConnection;
    const queuedOfferSdp = 'offer-delivered-after-neorest-reconnect';
    const signalResponse = await (secondClient as any).conn.sendLive('/calls/reconnect', {
      action: 'signal',
      sessionId: second.id,
      targetParticipantId: first.participantId,
      attemptId: 'queued-reconnect-attempt',
      sequence: 0,
      signal: {
        type: 'description',
        description: { type: 'offer', sdp: queuedOfferSdp },
      },
    });
    expect(signalResponse.error).toBeUndefined();
    expect(firstPeer.remoteDescription?.sdp).not.toBe(queuedOfferSdp);

    await waitFor(() => connectionChanges.includes(true));
    await waitFor(() => firstPeer.remoteDescription?.sdp === queuedOfferSdp);

    expect(first.state).toBe('connected');
    expect(second.state).toBe('connected');
    expect(first.peerId).toBe(second.participantId);
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(FakePeerConnection.instances.every((peer) => peer.connectionState === 'connected')).toBe(true);
    removeListener();
  });
});

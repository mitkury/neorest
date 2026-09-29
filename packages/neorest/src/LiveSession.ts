import type {
  LiveIceCandidate,
  LiveClientMessage,
  LiveJoinResult,
  LivePeerInfo,
  LiveServerEvent,
  LiveSignal,
} from './core/live';
import { newConnectionSecret } from './core/utils/connectionSecret';

export type LiveSessionState =
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export interface LiveOptions {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
  /** Use an application-owned stream instead of calling getUserMedia. */
  stream?: MediaStream;
  /** Request remote media even when no local track of that kind is sent. */
  receive?: {
    audio?: boolean;
    video?: boolean;
  };
  /** Data channels created by the offerer. Incoming channels use the same labels. */
  data?: Record<string, RTCDataChannelInit>;
  rtcConfiguration?: Omit<RTCConfiguration, 'iceServers'>;
  disconnectedGraceMs?: number;
  negotiationTimeoutMs?: number;
  /** Timeout for each Neorest join/leave/signaling request. Defaults to 15s. */
  signalingTimeoutMs?: number;
  /** Defaults to true for captured streams and false for `stream`. */
  stopLocalTracksOnLeave?: boolean;
}

interface LiveSessionControl {
  send(message: LiveClientMessage): Promise<void>;
  closed(session: LiveSession): void;
}

interface LiveSessionRuntime {
  localStream: MediaStream | null;
  ownsLocalStream: boolean;
  options: LiveOptions;
}

export class LiveSession {
  public readonly id: string;
  public readonly participantId: string;
  public readonly path: string;
  public readonly localStream: MediaStream | null;

  private currentState: LiveSessionState = 'waiting';
  private remotePeerId: string | null = null;
  private remoteStreamValue: MediaStream | null = null;
  private peerConnectionValue: RTCPeerConnection | null = null;
  private offerer = false;
  private activeAttemptId: string | null = null;
  private localSequence = 0;
  private canSendLocalCandidates = false;
  private localCandidatesComplete = false;
  private pendingLocalCandidates: LiveIceCandidate[] = [];
  private readonly remoteSequences = new Map<string, number>();
  private readonly dataChannels = new Map<string, RTCDataChannel>();
  private readonly stateListeners = new Set<(state: LiveSessionState) => void>();
  private readonly remoteStreamListeners = new Set<(stream: MediaStream) => void>();
  private readonly dataChannelListeners = new Set<(label: string, channel: RTCDataChannel) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private incomingQueue: Promise<void> = Promise.resolve();
  private outgoingQueue: Promise<void> = Promise.resolve();
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  private negotiationTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private restartInFlight = false;
  private leaving = false;

  constructor(
    result: LiveJoinResult,
    private readonly control: LiveSessionControl,
    private readonly runtime: LiveSessionRuntime,
  ) {
    this.id = result.sessionId;
    this.participantId = result.participantId;
    this.path = result.path;
    this.localStream = runtime.localStream;
    this.iceServers = result.iceServers;
  }

  private readonly iceServers: LiveJoinResult['iceServers'];

  get state(): LiveSessionState {
    return this.currentState;
  }

  get peerId(): string | null {
    return this.remotePeerId;
  }

  get remoteStream(): MediaStream | null {
    return this.remoteStreamValue;
  }

  getDataChannel(label: string): RTCDataChannel | undefined {
    return this.dataChannels.get(label);
  }

  async getStats(): Promise<RTCStatsReport> {
    if (!this.peerConnectionValue) {
      throw new Error('Live session does not currently have a peer connection');
    }
    return this.peerConnectionValue.getStats();
  }

  /** Replace an already-negotiated outgoing track without renegotiation. */
  async replaceTrack(
    currentTrack: MediaStreamTrack,
    replacement: MediaStreamTrack | null,
  ): Promise<void> {
    const peerConnection = this.requirePeerConnection();
    const sender = peerConnection.getSenders().find((candidate) => candidate.track === currentTrack);
    if (!sender) {
      throw new Error('The live session is not sending the supplied track');
    }
    if (replacement && replacement.kind !== currentTrack.kind) {
      throw new Error('A replacement live track must have the same media kind');
    }
    await sender.replaceTrack(replacement);
    if (this.localStream) {
      this.localStream.removeTrack(currentTrack);
      if (replacement) this.localStream.addTrack(replacement);
    }
  }

  onStateChange(listener: (state: LiveSessionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onRemoteStream(listener: (stream: MediaStream) => void): () => void {
    this.remoteStreamListeners.add(listener);
    if (this.remoteStreamValue) listener(this.remoteStreamValue);
    return () => this.remoteStreamListeners.delete(listener);
  }

  onDataChannel(
    listener: (label: string, channel: RTCDataChannel) => void,
  ): () => void {
    this.dataChannelListeners.add(listener);
    for (const [label, channel] of this.dataChannels) listener(label, channel);
    return () => this.dataChannelListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  start(peers: LivePeerInfo[]): void {
    if (peers.length > 1) {
      throw new Error('A one-to-one live session cannot start with multiple peers');
    }
    const peer = peers[0];
    if (peer) this.addPeer(peer);
  }

  handleEvent(event: LiveServerEvent): void {
    if (event.sessionId !== this.id || this.currentState === 'closed') return;
    if (event.action === 'peer-joined') {
      try {
        this.addPeer(event.peer);
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    if (event.action === 'peer-left') {
      if (event.participantId === this.remotePeerId) {
        this.closePeerConnection();
        this.remotePeerId = null;
        this.setState('waiting');
      }
      return;
    }
    if (event.action === 'session-closed') {
      this.closeLocally();
      return;
    }
    if (event.fromParticipantId !== this.remotePeerId) return;
    this.incomingQueue = this.incomingQueue
      .then(() => this.applyRemoteSignal(event.attemptId, event.sequence, event.signal))
      .catch((error) => this.fail(error));
  }

  async leave(): Promise<void> {
    if (this.leaving || this.currentState === 'closed') return;
    this.leaving = true;
    const request = this.control.send({ action: 'leave', sessionId: this.id });
    this.closeLocally();
    try {
      await request;
    } finally {
      this.leaving = false;
    }
  }

  closeLocally(): void {
    if (this.currentState === 'closed') return;
    this.closePeerConnection();
    const shouldStopTracks = this.runtime.options.stopLocalTracksOnLeave
      ?? this.runtime.ownsLocalStream;
    if (shouldStopTracks) {
      for (const track of this.localStream?.getTracks() || []) track.stop();
    }
    this.setState('closed');
    this.control.closed(this);
  }

  private addPeer(peer: LivePeerInfo): void {
    if (this.remotePeerId === peer.participantId) return;
    if (this.remotePeerId) {
      this.fail(new Error('A one-to-one live session received an additional peer'));
      return;
    }
    this.remotePeerId = peer.participantId;
    this.offerer = peer.offerer;
    this.restartAttempts = 0;
    const peerConnection = this.createPeerConnection();
    this.peerConnectionValue = peerConnection;
    this.setState('connecting');
    if (this.offerer) {
      this.startNegotiationTimeout();
      this.createConfiguredDataChannels(peerConnection);
      void this.createAndSendOffer(false).catch((error) => this.fail(error));
    }
  }

  private createPeerConnection(): RTCPeerConnection {
    const PeerConnection = globalThis.RTCPeerConnection;
    if (!PeerConnection) throw new Error('WebRTC is not available in this environment');
    const peerConnection = new PeerConnection({
      ...(this.runtime.options.rtcConfiguration || {}),
      iceServers: this.iceServers,
    });
    const aggregateRemoteStream = new MediaStream();

    const localKinds = new Set(
      (this.localStream?.getTracks() || []).map((track) => track.kind),
    );
    if (this.runtime.options.receive?.audio && !localKinds.has('audio')) {
      peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    }
    if (this.runtime.options.receive?.video && !localKinds.has('video')) {
      peerConnection.addTransceiver('video', { direction: 'recvonly' });
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        peerConnection.addTrack(track, this.localStream);
      }
    }

    peerConnection.addEventListener('icecandidate', (event) => {
      if (this.peerConnectionValue !== peerConnection) return;
      if (event.candidate) {
        const candidate = this.serializeCandidate(event.candidate);
        if (this.canSendLocalCandidates) {
          void this.sendSignal({ type: 'candidate', candidate });
        } else {
          this.pendingLocalCandidates.push(candidate);
        }
      } else {
        this.localCandidatesComplete = true;
        if (this.canSendLocalCandidates) void this.sendCandidatesComplete();
      }
    });
    peerConnection.addEventListener('track', (event) => {
      if (this.peerConnectionValue !== peerConnection) return;
      if (!aggregateRemoteStream.getTracks().includes(event.track)) {
        aggregateRemoteStream.addTrack(event.track);
      }
      if (!this.remoteStreamValue) {
        this.remoteStreamValue = aggregateRemoteStream;
        this.notifyRemoteStream(aggregateRemoteStream);
      }
    });
    peerConnection.addEventListener('datachannel', (event) => {
      if (this.peerConnectionValue === peerConnection) {
        this.registerDataChannel(event.channel);
      }
    });
    peerConnection.addEventListener('connectionstatechange', () => {
      if (this.peerConnectionValue !== peerConnection) return;
      this.handleConnectionState(peerConnection.connectionState);
    });
    peerConnection.addEventListener('iceconnectionstatechange', () => {
      if (this.peerConnectionValue !== peerConnection) return;
      if (peerConnection.iceConnectionState === 'disconnected') {
        this.beginDisconnectedGrace();
      } else if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
        this.markConnected();
      } else if (peerConnection.iceConnectionState === 'failed') {
        this.beginIceRestart();
      }
    });
    return peerConnection;
  }

  private createConfiguredDataChannels(peerConnection: RTCPeerConnection): void {
    for (const [label, options] of Object.entries(this.runtime.options.data || {})) {
      this.registerDataChannel(peerConnection.createDataChannel(label, options));
    }
  }

  private registerDataChannel(channel: RTCDataChannel): void {
    const existing = this.dataChannels.get(channel.label);
    if (existing && existing !== channel) existing.close();
    this.dataChannels.set(channel.label, channel);
    channel.addEventListener('close', () => {
      if (this.dataChannels.get(channel.label) === channel) {
        this.dataChannels.delete(channel.label);
      }
    });
    for (const listener of this.dataChannelListeners) {
      try {
        listener(channel.label, channel);
      } catch (error) {
        console.error('Error in live data-channel listener', error);
      }
    }
  }

  private async createAndSendOffer(restart: boolean): Promise<void> {
    const peerConnection = this.requirePeerConnection();
    if (peerConnection.signalingState !== 'stable') {
      throw new Error('Cannot create a WebRTC offer while negotiation is in progress');
    }
    this.offerer = true;
    this.beginLocalAttempt(newConnectionSecret());
    const offer = await peerConnection.createOffer(restart ? { iceRestart: true } : undefined);
    await peerConnection.setLocalDescription(offer);
    const description = peerConnection.localDescription;
    if (!description?.sdp || description.type !== 'offer') {
      throw new Error('WebRTC did not produce a valid offer');
    }
    await this.sendDescription({ type: 'offer', sdp: description.sdp });
  }

  private async applyRemoteSignal(
    attemptId: string,
    sequence: number,
    signal: LiveSignal,
  ): Promise<void> {
    if (this.currentState === 'closed' || !this.remotePeerId) return;
    const previousSequence = this.remoteSequences.get(attemptId) ?? -1;
    if (sequence <= previousSequence) return;
    if (sequence !== previousSequence + 1) {
      throw new Error('Received out-of-order live signaling');
    }
    this.remoteSequences.set(attemptId, sequence);
    if (this.remoteSequences.size > 32) {
      const oldestAttempt = this.remoteSequences.keys().next().value;
      if (oldestAttempt) this.remoteSequences.delete(oldestAttempt);
    }

    const peerConnection = this.requirePeerConnection();
    if (signal.type === 'description') {
      if (signal.description.type === 'offer') {
        if (peerConnection.signalingState !== 'stable') {
          throw new Error('Received a WebRTC offer while negotiation was already in progress');
        }
        this.offerer = false;
        this.startNegotiationTimeout();
        this.beginLocalAttempt(attemptId);
        await peerConnection.setRemoteDescription(signal.description);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        const description = peerConnection.localDescription;
        if (!description?.sdp || description.type !== 'answer') {
          throw new Error('WebRTC did not produce a valid answer');
        }
        await this.sendDescription({ type: 'answer', sdp: description.sdp });
        return;
      }
      if (this.activeAttemptId !== attemptId) return;
      await peerConnection.setRemoteDescription(signal.description);
      return;
    }
    if (this.activeAttemptId !== attemptId) return;
    await this.applyNonDescriptionSignal(peerConnection, signal);
  }

  private async applyNonDescriptionSignal(
    peerConnection: RTCPeerConnection,
    signal: Exclude<LiveSignal, { type: 'description' }>,
  ): Promise<void> {
    if (signal.type === 'candidate') {
      await peerConnection.addIceCandidate(signal.candidate);
    } else {
      await peerConnection.addIceCandidate(null);
    }
  }

  private beginLocalAttempt(attemptId: string): void {
    this.activeAttemptId = attemptId;
    this.localSequence = 0;
    this.canSendLocalCandidates = false;
    this.localCandidatesComplete = false;
    this.pendingLocalCandidates = [];
  }

  private async sendDescription(
    description: { type: 'offer' | 'answer'; sdp: string },
  ): Promise<void> {
    await this.sendSignal({ type: 'description', description });
    this.canSendLocalCandidates = true;
    const candidates = this.pendingLocalCandidates.splice(0);
    for (const candidate of candidates) {
      void this.sendSignal({ type: 'candidate', candidate });
    }
    if (this.localCandidatesComplete) void this.sendCandidatesComplete();
  }

  private sendCandidatesComplete(): Promise<void> {
    return this.sendSignal({ type: 'candidates-complete' });
  }

  private sendSignal(signal: LiveSignal): Promise<void> {
    const attemptId = this.activeAttemptId;
    const targetParticipantId = this.remotePeerId;
    if (!attemptId || !targetParticipantId) {
      return Promise.reject(new Error('Live peer is no longer available'));
    }
    const sequence = this.localSequence++;
    const operation = this.outgoingQueue.then(() => this.control.send({
      action: 'signal',
      sessionId: this.id,
      targetParticipantId,
      attemptId,
      sequence,
      signal,
    }));
    this.outgoingQueue = operation.catch((error) => {
      this.emitError(this.asError(error));
    });
    return operation;
  }

  private handleConnectionState(state: RTCPeerConnectionState): void {
    if (state === 'connected') {
      this.markConnected();
    } else if (state === 'disconnected') {
      this.beginDisconnectedGrace();
    } else if (state === 'failed') {
      this.beginIceRestart();
    } else if (state === 'closed' && this.currentState !== 'closed') {
      this.setState('failed');
    }
  }

  private markConnected(): void {
    this.restartAttempts = 0;
    this.restartInFlight = false;
    this.clearDisconnectedTimer();
    this.clearNegotiationTimer();
    this.setState('connected');
  }

  private beginDisconnectedGrace(): void {
    if (this.disconnectedTimer || this.currentState === 'closed') return;
    this.setState('reconnecting');
    const graceMs = this.runtime.options.disconnectedGraceMs ?? 8_000;
    this.disconnectedTimer = setTimeout(() => {
      this.disconnectedTimer = null;
      this.beginIceRestart();
    }, graceMs);
  }

  private beginIceRestart(): void {
    if (this.currentState === 'closed' || this.currentState === 'waiting') return;
    this.clearDisconnectedTimer();
    this.setState('reconnecting');
    if (!this.offerer) {
      if (!this.negotiationTimer) this.startNegotiationTimeout();
      return;
    }
    if (this.restartInFlight) return;
    if (this.restartAttempts >= 2) {
      this.setState('failed');
      return;
    }
    this.restartAttempts++;
    this.restartInFlight = true;
    this.startNegotiationTimeout();
    void this.createAndSendOffer(true).catch((error) => {
      this.restartInFlight = false;
      this.fail(error);
    });
  }

  private startNegotiationTimeout(): void {
    this.clearNegotiationTimer();
    const timeoutMs = this.runtime.options.negotiationTimeoutMs ?? 20_000;
    this.negotiationTimer = setTimeout(() => {
      this.negotiationTimer = null;
      if (this.currentState !== 'connected' && this.currentState !== 'closed') {
        this.restartInFlight = false;
        this.setState('failed');
      }
    }, timeoutMs);
  }

  private closePeerConnection(): void {
    this.clearDisconnectedTimer();
    this.clearNegotiationTimer();
    const peerConnection = this.peerConnectionValue;
    this.peerConnectionValue = null;
    for (const channel of this.dataChannels.values()) channel.close();
    this.dataChannels.clear();
    peerConnection?.close();
    for (const track of this.remoteStreamValue?.getTracks() || []) track.stop();
    this.remoteStreamValue = null;
    this.activeAttemptId = null;
    this.restartInFlight = false;
    this.remoteSequences.clear();
  }

  private requirePeerConnection(): RTCPeerConnection {
    if (!this.peerConnectionValue) throw new Error('Live peer connection is not available');
    return this.peerConnectionValue;
  }

  private serializeCandidate(candidate: RTCIceCandidate): LiveIceCandidate {
    const json = candidate.toJSON();
    return {
      candidate: json.candidate || candidate.candidate,
      sdpMid: json.sdpMid,
      sdpMLineIndex: json.sdpMLineIndex,
      usernameFragment: json.usernameFragment,
    };
  }

  private setState(state: LiveSessionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('Error in live state listener', error);
      }
    }
  }

  private fail(error: unknown): void {
    this.emitError(this.asError(error));
    if (this.currentState !== 'closed') this.setState('failed');
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        console.error('Error in live error listener', listenerError);
      }
    }
  }

  private notifyRemoteStream(stream: MediaStream): void {
    for (const listener of this.remoteStreamListeners) {
      try {
        listener(stream);
      } catch (error) {
        console.error('Error in live remote-stream listener', error);
      }
    }
  }

  private asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private clearDisconnectedTimer(): void {
    if (this.disconnectedTimer) clearTimeout(this.disconnectedTimer);
    this.disconnectedTimer = null;
  }

  private clearNegotiationTimer(): void {
    if (this.negotiationTimer) clearTimeout(this.negotiationTimer);
    this.negotiationTimer = null;
  }
}

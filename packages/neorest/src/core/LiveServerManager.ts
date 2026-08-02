import type { ServerConnection } from './ServerConnection';
import type { Payload, RequestContext } from './types';
import {
  type LiveClientMessage,
  type LiveIceCandidate,
  type LiveIceServer,
  type LiveJoinResult,
  type LiveLeaveReason,
  type LivePeerConnectionFactory,
  type LiveRoomAuthorizationResult,
  type LiveRoomContext,
  type LiveServerCloseContext,
  type LiveServerEvent,
  type LiveServerOptions,
  type LiveServerPeer,
  type LiveServerSessionContext,
  type LiveSignal,
} from './live';
import { newConnectionSecret } from './utils/connectionSecret';

interface LiveServerDefinition {
  route: string;
  options: LiveServerOptions;
}

interface LiveServerSession {
  id: string;
  key: string;
  path: string;
  params: Record<string, string>;
  definition: LiveServerDefinition;
  connection: ServerConnection;
  participantId: string;
  serverParticipantId: string;
  iceServers: LiveIceServer[];
  peerConnection: RTCPeerConnection;
  peer: LiveServerPeerImpl;
  remoteSequences: Map<string, number>;
  activeAttemptId: string | null;
  localSequence: number;
  canSendCandidates: boolean;
  localCandidatesComplete: boolean;
  pendingCandidates: LiveIceCandidate[];
  incomingQueue: Promise<void>;
  outgoingQueue: Promise<void>;
  disconnectedTimer: ReturnType<typeof setTimeout> | null;
  negotiationTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

class LiveRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class LiveServerPeerImpl implements LiveServerPeer {
  private readonly trackListeners = new Set<(event: RTCTrackEvent) => void>();
  private readonly dataChannelListeners = new Set<(channel: RTCDataChannel) => void>();

  constructor(public readonly connection: RTCPeerConnection) {
    connection.ontrack = (event) => this.notify(this.trackListeners, event);
    connection.ondatachannel = (event) => this.notify(this.dataChannelListeners, event.channel);
  }

  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
    return this.connection.addTrack(track, ...streams);
  }

  addTransceiver(
    trackOrKind: MediaStreamTrack | 'audio' | 'video',
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver {
    return this.connection.addTransceiver(trackOrKind, init);
  }

  createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    return this.connection.createDataChannel(label, options);
  }

  onTrack(listener: (event: RTCTrackEvent) => void): () => void {
    this.trackListeners.add(listener);
    return () => this.trackListeners.delete(listener);
  }

  onDataChannel(listener: (channel: RTCDataChannel) => void): () => void {
    this.dataChannelListeners.add(listener);
    return () => this.dataChannelListeners.delete(listener);
  }

  getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> {
    return this.connection.getStats(selector);
  }

  close(): void {
    this.trackListeners.clear();
    this.dataChannelListeners.clear();
    this.connection.ontrack = null;
    this.connection.ondatachannel = null;
  }

  private notify<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        console.error('Error in live server peer listener', error);
      }
    }
  }
}

const MAX_SDP_LENGTH = 256 * 1024;
const MAX_CANDIDATE_LENGTH = 16 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_ICE_SERVERS = 16;
const MAX_SIGNALS_PER_ATTEMPT = 512;

export class LiveServerManager {
  private readonly definitions = new Map<string, LiveServerDefinition>();
  private readonly sessions = new Map<string, LiveServerSession>();
  private readonly joinQueues = new Map<string, Promise<void>>();
  private generation = 0;

  constructor(private readonly createPeerConnection?: LivePeerConnectionFactory) {}

  register(route: string, options: LiveServerOptions): LiveServerDefinition {
    for (const [name, value] of [
      ['disconnectedGraceMs', options.disconnectedGraceMs],
      ['offerTimeoutMs', options.offerTimeoutMs],
      ['negotiationTimeoutMs', options.negotiationTimeoutMs],
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new Error(`${name} must be a positive number`);
      }
    }
    const existing = this.definitions.get(route);
    if (existing) {
      existing.options = { ...options };
      return existing;
    }
    const definition = { route, options: { ...options } };
    this.definitions.set(route, definition);
    return definition;
  }

  async handle(definition: LiveServerDefinition, context: RequestContext): Promise<void> {
    try {
      const message = this.readMessage(context.data);
      const key = this.sessionKey(definition, context.route);
      switch (message.action) {
        case 'join':
          context.response = await this.enqueue(key, () => this.join(definition, context));
          return;
        case 'leave':
          await this.enqueue(key, () => this.leave(definition, context, message.sessionId));
          context.response = 'OK';
          return;
        case 'signal':
          await this.signal(definition, context, message);
          context.response = 'OK';
          return;
      }
    } catch (error) {
      if (error instanceof LiveRequestError) {
        context.statusCode = error.status;
        context.error = error.message;
        return;
      }
      throw error;
    }
  }

  removeConnection(connection: ServerConnection): void {
    for (const session of [...this.sessions.values()]) {
      if (session.connection === connection) {
        this.closeSession(session, 'connection-closed');
      }
    }
  }

  close(): void {
    this.generation++;
    for (const session of [...this.sessions.values()]) {
      this.sendEvent(session, {
        action: 'session-closed',
        sessionId: session.id,
        reason: 'server-closed',
      });
      this.closeSession(session, 'server-closed');
    }
    this.sessions.clear();
    this.joinQueues.clear();
  }

  private async join(
    definition: LiveServerDefinition,
    request: RequestContext,
  ): Promise<LiveJoinResult> {
    if (!this.createPeerConnection) {
      throw new LiveRequestError(
        501,
        'This router needs createLivePeerConnection to host live WebRTC sessions',
      );
    }
    const generation = this.generation;
    const context = this.roomContext(request);
    await this.authorize(definition, context);
    this.assertGeneration(generation);

    const key = this.sessionKey(definition, request.route);
    const existing = this.sessions.get(key);
    if (existing) {
      if (existing.connection !== request.sender) {
        throw new LiveRequestError(409, 'A live server session is already active on this route');
      }
      return this.joinResult(existing, existing.iceServers);
    }

    const iceServers = await this.resolveIceServers(definition, context);
    this.assertGeneration(generation);
    if (!request.sender.getTransport().isConnected()) {
      throw new LiveRequestError(503, 'Connection closed while joining the live route');
    }

    let peerConnection: RTCPeerConnection;
    try {
      peerConnection = this.createPeerConnection({
        ...(definition.options.rtcConfiguration || {}),
        iceServers,
      });
    } catch (error) {
      throw new LiveRequestError(503, `Could not create the server WebRTC peer: ${this.errorMessage(error)}`);
    }

    const session: LiveServerSession = {
      id: newConnectionSecret(),
      key,
      path: request.route,
      params: { ...request.params },
      definition,
      connection: request.sender,
      participantId: newConnectionSecret(),
      serverParticipantId: newConnectionSecret(),
      iceServers,
      peerConnection,
      peer: new LiveServerPeerImpl(peerConnection),
      remoteSequences: new Map(),
      activeAttemptId: null,
      localSequence: 0,
      canSendCandidates: false,
      localCandidatesComplete: false,
      pendingCandidates: [],
      incomingQueue: Promise.resolve(),
      outgoingQueue: Promise.resolve(),
      disconnectedTimer: null,
      negotiationTimer: null,
      closed: false,
    };
    this.sessions.set(key, session);
    this.configurePeerConnection(session);

    try {
      await definition.options.open?.(this.sessionContext(session));
      this.assertGeneration(generation);
      if (this.sessions.get(key) !== session || !request.sender.getTransport().isConnected()) {
        throw new LiveRequestError(503, 'Connection closed while opening the live route');
      }
    } catch (error) {
      this.closeSession(session, 'peer-failed');
      throw error;
    }

    this.startOfferTimeout(session);
    return this.joinResult(session, iceServers);
  }

  private async leave(
    definition: LiveServerDefinition,
    request: RequestContext,
    sessionId?: string,
  ): Promise<void> {
    if (sessionId !== undefined) this.assertId(sessionId, 'sessionId');
    const session = this.sessions.get(this.sessionKey(definition, request.route));
    if (!session || (sessionId !== undefined && session.id !== sessionId)) {
      throw new LiveRequestError(404, 'Live session was not found');
    }
    if (session.connection !== request.sender) {
      throw new LiveRequestError(403, 'Connection does not own this live session');
    }
    this.closeSession(session, 'left');
  }

  private async signal(
    definition: LiveServerDefinition,
    request: RequestContext,
    message: Extract<LiveClientMessage, { action: 'signal' }>,
  ): Promise<void> {
    this.assertId(message.sessionId, 'sessionId');
    this.assertId(message.targetParticipantId, 'targetParticipantId');
    this.assertId(message.attemptId, 'attemptId');
    if (!Number.isInteger(message.sequence) || message.sequence < 0) {
      throw new LiveRequestError(400, 'Live signal sequence must be a non-negative integer');
    }
    if (message.sequence >= MAX_SIGNALS_PER_ATTEMPT) {
      throw new LiveRequestError(429, 'Live signaling attempt exceeded its message limit');
    }
    this.validateSignal(message.signal);

    const session = this.sessions.get(this.sessionKey(definition, request.route));
    if (!session || session.id !== message.sessionId) {
      throw new LiveRequestError(404, 'Live session was not found');
    }
    if (session.connection !== request.sender) {
      throw new LiveRequestError(403, 'Connection does not own this live session');
    }
    if (message.targetParticipantId !== session.serverParticipantId) {
      throw new LiveRequestError(404, 'Target live participant was not found');
    }

    const previous = session.remoteSequences.get(message.attemptId) ?? -1;
    if (message.sequence <= previous) return;
    if (message.sequence !== previous + 1) {
      throw new LiveRequestError(409, 'Live signals must be sent in sequence');
    }
    session.remoteSequences.set(message.attemptId, message.sequence);
    if (session.remoteSequences.size > 16) {
      const oldest = session.remoteSequences.keys().next().value;
      if (oldest) session.remoteSequences.delete(oldest);
    }

    const operation = session.incomingQueue
      .catch(() => {})
      .then(() => this.applyRemoteSignal(session, message.attemptId, message.signal));
    session.incomingQueue = operation;
    try {
      await operation;
    } catch (error) {
      if (message.signal.type === 'description') this.failSession(session);
      throw error;
    }
  }

  private async applyRemoteSignal(
    session: LiveServerSession,
    attemptId: string,
    signal: LiveSignal,
  ): Promise<void> {
    if (session.closed) return;
    const peerConnection = session.peerConnection;
    if (signal.type === 'description') {
      if (signal.description.type !== 'offer') {
        throw new LiveRequestError(409, 'The client must initiate server live negotiation');
      }
      if (peerConnection.signalingState !== 'stable') {
        throw new LiveRequestError(409, 'WebRTC negotiation is already in progress');
      }
      this.beginAttempt(session, attemptId);
      await peerConnection.setRemoteDescription(signal.description);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      const description = peerConnection.localDescription;
      if (
        !description?.sdp
        || description.type !== 'answer'
        || description.sdp.length > MAX_SDP_LENGTH
      ) {
        throw new LiveRequestError(500, 'Server WebRTC peer did not produce a valid answer');
      }
      this.sendSignal(session, attemptId, {
        type: 'description',
        description: { type: 'answer', sdp: description.sdp },
      });
      session.canSendCandidates = true;
      for (const candidate of session.pendingCandidates.splice(0)) {
        this.sendSignal(session, attemptId, { type: 'candidate', candidate });
      }
      if (session.localCandidatesComplete) {
        this.sendSignal(session, attemptId, { type: 'candidates-complete' });
      }
      return;
    }
    if (session.activeAttemptId !== attemptId) {
      throw new LiveRequestError(409, 'Live signal belongs to an inactive negotiation attempt');
    }
    if (signal.type === 'candidate') {
      await peerConnection.addIceCandidate(signal.candidate);
    } else {
      await peerConnection.addIceCandidate(null);
    }
  }

  private configurePeerConnection(session: LiveServerSession): void {
    const peerConnection = session.peerConnection;
    peerConnection.onicecandidate = (event) => {
      if (session.closed || !session.activeAttemptId) return;
      if (event.candidate) {
        const candidate = this.serializeCandidate(event.candidate);
        if (
          !candidate.candidate
          || candidate.candidate.length > MAX_CANDIDATE_LENGTH
          || (
            !session.canSendCandidates
            && session.pendingCandidates.length >= MAX_SIGNALS_PER_ATTEMPT - 2
          )
        ) {
          this.failSession(session);
          return;
        }
        if (session.canSendCandidates) {
          this.sendSignal(session, session.activeAttemptId, { type: 'candidate', candidate });
        } else {
          session.pendingCandidates.push(candidate);
        }
      } else {
        session.localCandidatesComplete = true;
        if (session.canSendCandidates) {
          this.sendSignal(session, session.activeAttemptId, { type: 'candidates-complete' });
        }
      }
    };
    peerConnection.onconnectionstatechange = () => {
      this.handleConnectionState(session, peerConnection.connectionState);
    };
    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        this.markConnected(session);
      } else if (state === 'disconnected') {
        this.beginDisconnectedGrace(session);
      } else if (state === 'failed') {
        this.waitForRestart(session);
      }
    };
  }

  private beginAttempt(session: LiveServerSession, attemptId: string): void {
    session.activeAttemptId = attemptId;
    session.localSequence = 0;
    session.canSendCandidates = false;
    session.localCandidatesComplete = false;
    session.pendingCandidates = [];
    this.startNegotiationTimeout(session, true);
  }

  private sendSignal(session: LiveServerSession, attemptId: string, signal: LiveSignal): void {
    if (session.localSequence >= MAX_SIGNALS_PER_ATTEMPT) {
      this.failSession(session);
      return;
    }
    const sequence = session.localSequence++;
    session.outgoingQueue = session.outgoingQueue.catch(() => {}).then(() => {
      if (session.closed || session.activeAttemptId !== attemptId) return;
      this.sendEvent(session, {
        action: 'signal',
        sessionId: session.id,
        fromParticipantId: session.serverParticipantId,
        attemptId,
        sequence,
        signal,
      });
    });
  }

  private handleConnectionState(
    session: LiveServerSession,
    state: RTCPeerConnectionState,
  ): void {
    if (state === 'connected') {
      this.markConnected(session);
    } else if (state === 'disconnected') {
      this.beginDisconnectedGrace(session);
    } else if (state === 'failed') {
      this.waitForRestart(session);
    } else if (state === 'closed' && !session.closed) {
      this.failSession(session);
    }
  }

  private markConnected(session: LiveServerSession): void {
    this.clearTimer(session, 'disconnectedTimer');
    this.clearTimer(session, 'negotiationTimer');
  }

  private beginDisconnectedGrace(session: LiveServerSession): void {
    if (session.closed || session.disconnectedTimer) return;
    const delay = session.definition.options.disconnectedGraceMs ?? 8_000;
    session.disconnectedTimer = setTimeout(() => {
      session.disconnectedTimer = null;
      if (
        session.peerConnection.connectionState === 'disconnected'
        || session.peerConnection.iceConnectionState === 'disconnected'
      ) {
        this.waitForRestart(session);
      }
    }, delay);
  }

  private waitForRestart(session: LiveServerSession): void {
    if (session.closed) return;
    this.clearTimer(session, 'disconnectedTimer');
    this.startNegotiationTimeout(session);
  }

  private startOfferTimeout(session: LiveServerSession): void {
    this.clearTimer(session, 'negotiationTimer');
    const delay = session.definition.options.offerTimeoutMs ?? 60_000;
    session.negotiationTimer = setTimeout(() => {
      session.negotiationTimer = null;
      if (!session.activeAttemptId) this.failSession(session);
    }, delay);
  }

  private startNegotiationTimeout(session: LiveServerSession, reset = false): void {
    if (session.negotiationTimer && !reset) return;
    this.clearTimer(session, 'negotiationTimer');
    const delay = session.definition.options.negotiationTimeoutMs ?? 20_000;
    session.negotiationTimer = setTimeout(() => {
      session.negotiationTimer = null;
      if (
        session.peerConnection.connectionState !== 'connected'
        && session.peerConnection.iceConnectionState !== 'connected'
        && session.peerConnection.iceConnectionState !== 'completed'
      ) {
        this.failSession(session);
      }
    }, delay);
  }

  private failSession(session: LiveServerSession): void {
    if (session.closed) return;
    this.sendEvent(session, {
      action: 'session-closed',
      sessionId: session.id,
      reason: 'peer-failed',
    });
    this.closeSession(session, 'peer-failed');
  }

  private closeSession(session: LiveServerSession, reason: LiveLeaveReason): void {
    if (session.closed) return;
    session.closed = true;
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    this.clearTimer(session, 'disconnectedTimer');
    this.clearTimer(session, 'negotiationTimer');
    // Give applications a synchronous chance to stop provider-specific sinks,
    // sources, and recorders while the native peer is still valid. Async close
    // work remains best-effort and must not hold the router shutdown path.
    const context: LiveServerCloseContext = {
      ...this.sessionContext(session),
      reason,
    };
    try {
      void Promise.resolve(session.definition.options.onClose?.(context)).catch((error) => {
        console.error(`Live server close hook failed for "${session.path}"`, error);
      });
    } catch (error) {
      console.error(`Live server close hook failed for "${session.path}"`, error);
    }
    session.peer.close();
    session.peerConnection.onicecandidate = null;
    session.peerConnection.onconnectionstatechange = null;
    session.peerConnection.oniceconnectionstatechange = null;
    try {
      session.peerConnection.close();
    } catch {
      // Best-effort provider cleanup.
    }
  }

  private sessionContext(session: LiveServerSession): LiveServerSessionContext {
    return {
      connection: session.connection,
      path: session.path,
      params: { ...session.params },
      sessionId: session.id,
      participantId: session.participantId,
      peer: session.peer,
    };
  }

  private joinResult(session: LiveServerSession, iceServers: LiveIceServer[]): LiveJoinResult {
    return {
      protocol: 1,
      sessionId: session.id,
      participantId: session.participantId,
      path: session.path,
      iceServers,
      peers: [{ participantId: session.serverParticipantId, offerer: true }],
    };
  }

  private roomContext(request: RequestContext): LiveRoomContext {
    return {
      connection: request.sender,
      path: request.route,
      params: { ...request.params },
    };
  }

  private async authorize(
    definition: LiveServerDefinition,
    context: LiveRoomContext,
  ): Promise<void> {
    const result = await definition.options.authorize?.(context);
    if (result === undefined || result === true) return;
    const normalized: LiveRoomAuthorizationResult = typeof result === 'boolean'
      ? { allowed: result }
      : result;
    if (normalized.allowed) return;
    const status = Number.isInteger(normalized.status)
      && normalized.status! >= 400
      && normalized.status! <= 599
      ? normalized.status!
      : 403;
    throw new LiveRequestError(status, normalized.error || 'Live route access forbidden');
  }

  private async resolveIceServers(
    definition: LiveServerDefinition,
    context: LiveRoomContext,
  ): Promise<LiveIceServer[]> {
    const configured = typeof definition.options.iceServers === 'function'
      ? await definition.options.iceServers(context)
      : definition.options.iceServers || [];
    if (!Array.isArray(configured) || configured.length > MAX_ICE_SERVERS) {
      throw new LiveRequestError(500, `Live route must return at most ${MAX_ICE_SERVERS} ICE servers`);
    }
    return configured.map((server) => {
      if (!server || (typeof server.urls !== 'string' && !Array.isArray(server.urls))) {
        throw new LiveRequestError(500, 'Live route returned an invalid ICE server');
      }
      return { ...server, urls: Array.isArray(server.urls) ? [...server.urls] : server.urls };
    });
  }

  private readMessage(data: Payload): LiveClientMessage {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new LiveRequestError(400, 'Live message must be an object');
    }
    const action = (data as { action?: unknown }).action;
    if (action !== 'join' && action !== 'leave' && action !== 'signal') {
      throw new LiveRequestError(400, 'Unsupported live action');
    }
    return data as unknown as LiveClientMessage;
  }

  private validateSignal(signal: LiveSignal): void {
    if (!signal || typeof signal !== 'object') {
      throw new LiveRequestError(400, 'Live signal must be an object');
    }
    if (signal.type === 'description') {
      const description = signal.description;
      if (!description || (description.type !== 'offer' && description.type !== 'answer')) {
        throw new LiveRequestError(400, 'Live description type must be offer or answer');
      }
      if (typeof description.sdp !== 'string' || !description.sdp || description.sdp.length > MAX_SDP_LENGTH) {
        throw new LiveRequestError(400, 'Live SDP is empty or too large');
      }
      return;
    }
    if (signal.type === 'candidate') {
      const candidate = signal.candidate;
      if (!candidate || typeof candidate.candidate !== 'string' || !candidate.candidate) {
        throw new LiveRequestError(400, 'Live ICE candidate is required');
      }
      if (candidate.candidate.length > MAX_CANDIDATE_LENGTH) {
        throw new LiveRequestError(400, 'Live ICE candidate is too large');
      }
      return;
    }
    if (signal.type !== 'candidates-complete') {
      throw new LiveRequestError(400, 'Unsupported live signal type');
    }
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

  private sendEvent(session: LiveServerSession, event: LiveServerEvent): void {
    session.connection.sendToRouteAfterReconnect(
      session.path,
      'LIVE',
      event as unknown as Payload,
    );
  }

  private sessionKey(definition: LiveServerDefinition, path: string): string {
    return `${definition.route}\0${path}`;
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.joinQueues.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.joinQueues.set(key, tail);
    void tail.finally(() => {
      if (this.joinQueues.get(key) === tail) this.joinQueues.delete(key);
    });
    return result;
  }

  private assertId(value: string, name: string): void {
    if (typeof value !== 'string' || !value || value.length > MAX_ID_LENGTH) {
      throw new LiveRequestError(400, `${name} is invalid`);
    }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new LiveRequestError(503, 'Live server is closing');
    }
  }

  private clearTimer(
    session: LiveServerSession,
    key: 'disconnectedTimer' | 'negotiationTimer',
  ): void {
    if (session[key]) clearTimeout(session[key]!);
    session[key] = null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

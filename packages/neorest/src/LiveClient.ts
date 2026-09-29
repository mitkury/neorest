import type { ClientConnection } from './ClientConnection';
import { LiveSession, type LiveOptions } from './LiveSession';
import type {
  LiveClientMessage,
  LiveJoinResult,
  LiveServerEvent,
} from './core/live';

export class LiveClient {
  private readonly sessionsById = new Map<string, LiveSession>();
  private readonly sessionsByPath = new Map<string, LiveSession>();
  private readonly joiningPaths = new Set<string>();
  private readonly pendingJoins = new Set<Promise<LiveSession>>();
  private generation = 0;

  constructor(private readonly connection: ClientConnection) {}

  join(path: string, options: LiveOptions = {}): Promise<LiveSession> {
    const operation = this.joinInternal(path, options);
    this.pendingJoins.add(operation);
    operation.then(
      () => this.pendingJoins.delete(operation),
      () => this.pendingJoins.delete(operation),
    );
    return operation;
  }

  private async joinInternal(path: string, options: LiveOptions): Promise<LiveSession> {
    if (!this.connection.isConnected()) {
      throw new Error('Connect the Neorest client before joining a live route');
    }
    if (this.sessionsByPath.has(path) || this.joiningPaths.has(path)) {
      throw new Error(`A live session for "${path}" is already active`);
    }
    this.validateOptions(options);
    this.connection.validateClientRoute(path);
    if (!globalThis.RTCPeerConnection) {
      throw new Error('WebRTC is not available in this environment');
    }

    this.joiningPaths.add(path);
    let localStream: MediaStream | null = null;
    let ownsLocalStream = false;
    let joined: LiveJoinResult | null = null;
    let session: LiveSession | null = null;
    let joinRequested = false;
    let routeRegistered = false;
    const pendingEvents: LiveServerEvent[] = [];
    const signalingTimeoutMs = options.signalingTimeoutMs ?? 15_000;
    const generation = this.generation;
    try {
      this.connection.registerLiveRoute(path, (event) => {
        if (session) {
          session.handleEvent(event);
        } else if (pendingEvents.length < 256) {
          pendingEvents.push(event);
        }
      });
      routeRegistered = true;
      joinRequested = true;
      joined = await this.send<LiveJoinResult>(
        path,
        { action: 'join' },
        signalingTimeoutMs,
      );
      this.validateJoinResult(joined, path);
      this.assertGeneration(generation);

      // Ask for media only after the server has authenticated and authorized
      // the room. This avoids prompting a user for devices they cannot use.
      if (options.stream) {
        localStream = options.stream;
      } else if (options.audio || options.video) {
        const mediaDevices = globalThis.navigator?.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          throw new Error('Media capture is not available in this environment');
        }
        localStream = await mediaDevices.getUserMedia({
          audio: options.audio ?? false,
          video: options.video ?? false,
        });
        ownsLocalStream = true;
      }
      this.assertGeneration(generation);

      const createdSession = new LiveSession(joined, {
        send: (message) => this.send(
          path,
          message,
          signalingTimeoutMs,
        ).then(() => undefined),
        closed: (closedSession) => this.remove(closedSession),
      }, {
        localStream,
        ownsLocalStream,
        options,
      });
      session = createdSession;
      this.sessionsById.set(createdSession.id, createdSession);
      this.sessionsByPath.set(path, createdSession);
      createdSession.start(joined.peers);
      for (const event of pendingEvents) createdSession.handleEvent(event);
      return createdSession;
    } catch (error) {
      session?.closeLocally();
      if (joinRequested) {
        await this.send(path, {
          action: 'leave',
          sessionId: joined?.sessionId,
        }, signalingTimeoutMs).catch(() => {});
      }
      if (routeRegistered) this.connection.unregisterLiveRoute(path);
      if (ownsLocalStream || options.stopLocalTracksOnLeave) {
        for (const track of localStream?.getTracks() || []) track.stop();
      }
      throw error;
    } finally {
      this.joiningPaths.delete(path);
    }
  }

  get(path: string): LiveSession | undefined {
    return this.sessionsByPath.get(path);
  }

  async leaveAll(): Promise<void> {
    this.generation++;
    await Promise.allSettled([
      ...this.pendingJoins,
      ...[...this.sessionsById.values()].map((session) => session.leave()),
    ]);
  }

  close(): void {
    this.generation++;
    for (const session of [...this.sessionsById.values()]) {
      void session.leave().catch(() => {});
    }
  }

  private async send<T>(
    path: string,
    message: LiveClientMessage,
    timeoutMs?: number,
  ): Promise<T> {
    const response = await this.connection.sendLive<T>(path, message, timeoutMs);
    if (response.error) {
      throw new Error(`Live route "${path}" failed (${response.status || 500}): ${response.error}`);
    }
    return response.data;
  }

  private remove(session: LiveSession): void {
    if (this.sessionsById.get(session.id) === session) {
      this.sessionsById.delete(session.id);
    }
    if (this.sessionsByPath.get(session.path) === session) {
      this.sessionsByPath.delete(session.path);
      this.connection.unregisterLiveRoute(session.path);
    }
  }

  private validateOptions(options: LiveOptions): void {
    for (const [name, value] of [
      ['disconnectedGraceMs', options.disconnectedGraceMs],
      ['negotiationTimeoutMs', options.negotiationTimeoutMs],
      ['signalingTimeoutMs', options.signalingTimeoutMs],
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new Error(`${name} must be a positive number`);
      }
    }
    const labels = Object.keys(options.data || {});
    const hasRequestedMedia = Boolean(
      options.audio
      || options.video
      || (options.stream && options.stream.getTracks().length > 0)
      || options.receive?.audio
      || options.receive?.video
    );
    if (!hasRequestedMedia && labels.length === 0) {
      throw new Error('A live session requires media or at least one data channel');
    }
    if (labels.length > 16) throw new Error('A live session supports at most 16 data channels');
    for (const label of labels) {
      if (!label || label.length > 64) throw new Error('Live data channel labels must contain 1-64 characters');
      const channel = options.data?.[label];
      if (channel?.negotiated) {
        throw new Error('Negotiated data channels are not supported by live routes');
      }
      if (channel?.maxPacketLifeTime !== undefined && channel.maxRetransmits !== undefined) {
        throw new Error('A data channel cannot set both maxPacketLifeTime and maxRetransmits');
      }
    }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error('Live join was cancelled');
  }

  private validateJoinResult(result: LiveJoinResult, path: string): void {
    if (
      !result
      || typeof result !== 'object'
      || result.protocol !== 1
      || typeof result.sessionId !== 'string'
      || !result.sessionId
      || typeof result.participantId !== 'string'
      || !result.participantId
      || result.path !== path
      || !Array.isArray(result.iceServers)
      || !Array.isArray(result.peers)
      || result.peers.length > 1
      || result.peers.some((peer) => (
        !peer
        || typeof peer.participantId !== 'string'
        || !peer.participantId
        || typeof peer.offerer !== 'boolean'
      ))
    ) {
      throw new Error(`Live route "${path}" returned an invalid join response`);
    }
  }
}

export type { LiveOptions, LiveSessionState } from './LiveSession';
export { LiveSession } from './LiveSession';

import type { ServerConnection } from './ServerConnection';
import type { Payload, RequestContext } from './types';
import {
  type LiveClientMessage,
  type LiveIceServer,
  type LiveJoinResult,
  type LiveLeaveReason,
  type LiveRoomContext,
  type LiveRoomLeaveContext,
  type LiveRoomOptions,
  type LiveRoomParticipantContext,
  type LiveServerEvent,
  type LiveSignal,
} from './live';
import { newConnectionSecret } from './utils/connectionSecret';

interface LiveRoomDefinition {
  route: string;
  options: LiveRoomOptions;
}

interface LiveParticipant {
  id: string;
  connection: ServerConnection;
  signalSequences: Map<string, number>;
}

interface LiveRoom {
  id: string;
  key: string;
  path: string;
  params: Record<string, string>;
  definition: LiveRoomDefinition;
  participants: Map<string, LiveParticipant>;
  offererId: string | null;
}

class LiveRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_SDP_LENGTH = 256 * 1024;
const MAX_CANDIDATE_LENGTH = 16 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_ICE_SERVERS = 16;
const MAX_SIGNALS_PER_ATTEMPT = 512;

export class LiveRoomManager {
  private readonly definitions = new Map<string, LiveRoomDefinition>();
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly joinQueues = new Map<string, Promise<void>>();
  private generation = 0;

  register(route: string, options: LiveRoomOptions): LiveRoomDefinition {
    if (options.maxParticipants !== undefined && options.maxParticipants !== 2) {
      throw new Error('Live rooms currently support exactly two participants');
    }

    const existing = this.definitions.get(route);
    if (existing) {
      existing.options = { ...options, maxParticipants: 2 };
      return existing;
    }

    const definition: LiveRoomDefinition = {
      route,
      options: { ...options, maxParticipants: 2 },
    };
    this.definitions.set(route, definition);
    return definition;
  }

  async handle(
    definition: LiveRoomDefinition,
    context: RequestContext,
  ): Promise<void> {
    try {
      const message = this.readMessage(context.data);
      switch (message.action) {
        case 'join':
          context.response = await this.enqueueJoin(
            this.roomKey(definition, context.route),
            () => this.join(definition, context),
          );
          return;
        case 'leave':
          await this.enqueueJoin(
            this.roomKey(definition, context.route),
            () => this.leave(definition, context, message.sessionId),
          );
          context.response = 'OK';
          return;
        case 'signal':
          this.signal(definition, context, message);
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
    for (const room of [...this.rooms.values()]) {
      const participant = this.findParticipant(room, connection);
      if (participant) {
        this.removeParticipant(room, participant, 'connection-closed');
      }
    }
  }

  close(): void {
    this.generation++;
    for (const room of [...this.rooms.values()]) {
      for (const participant of room.participants.values()) {
        this.sendEvent(participant.connection, room.path, {
          action: 'session-closed',
          sessionId: room.id,
          reason: 'server-closed',
        });
        this.runLeaveHook(room, participant, 'server-closed');
      }
    }
    this.rooms.clear();
    this.joinQueues.clear();
  }

  private async join(
    definition: LiveRoomDefinition,
    request: RequestContext,
  ): Promise<LiveJoinResult> {
    const generation = this.generation;
    const roomContext = this.roomContext(request);
    const authorization = await definition.options.authorize?.(roomContext);
    this.assertGeneration(generation);
    if (authorization !== undefined) {
      const normalized = typeof authorization === 'boolean'
        ? { allowed: authorization }
        : authorization;
      if (!normalized.allowed) {
        const status = normalized.status !== undefined
          && Number.isInteger(normalized.status)
          && normalized.status >= 400
          && normalized.status <= 599
          ? normalized.status
          : 403;
        throw new LiveRequestError(
          status,
          normalized.error || 'Live room access forbidden',
        );
      }
    }

    const roomKey = this.roomKey(definition, request.route);
    let room = this.rooms.get(roomKey);
    const existing = room && this.findParticipant(room, request.sender);
    if (room && existing) {
      const iceServers = await this.resolveIceServers(definition, roomContext);
      this.assertGeneration(generation);
      return this.joinResult(room, existing, iceServers);
    }

    if (room && room.participants.size >= 2) {
      throw new LiveRequestError(409, 'Live room is full');
    }

    const iceServers = await this.resolveIceServers(definition, roomContext);
    this.assertGeneration(generation);
    if (!request.sender.getTransport().isConnected()) {
      throw new LiveRequestError(503, 'Connection closed while joining the live room');
    }
    room = this.rooms.get(roomKey);
    const participantAfterWait = room && this.findParticipant(room, request.sender);
    if (room && participantAfterWait) {
      return this.joinResult(room, participantAfterWait, iceServers);
    }
    if (!room) {
      room = {
        id: newConnectionSecret(),
        key: roomKey,
        path: request.route,
        params: { ...request.params },
        definition,
        participants: new Map(),
        offererId: null,
      };
      this.rooms.set(roomKey, room);
    }

    // Recheck after async authorization and ICE credential generation.
    if (room.participants.size >= 2) {
      throw new LiveRequestError(409, 'Live room is full');
    }

    const existingPeers = [...room.participants.values()];
    const participant: LiveParticipant = {
      id: newConnectionSecret(),
      connection: request.sender,
      signalSequences: new Map(),
    };
    room.participants.set(participant.id, participant);
    room.offererId = existingPeers.length > 0 ? participant.id : null;

    try {
      await definition.options.onJoin?.(
        this.participantContext(room, participant),
      );
      this.assertGeneration(generation);
      if (room.participants.get(participant.id) !== participant) {
        throw new LiveRequestError(503, 'Connection closed while joining the live room');
      }
    } catch (error) {
      room.participants.delete(participant.id);
      if (room.offererId === participant.id) room.offererId = null;
      if (room.participants.size === 0) this.rooms.delete(room.key);
      throw error;
    }

    for (const peer of existingPeers) {
      this.sendEvent(peer.connection, room.path, {
        action: 'peer-joined',
        sessionId: room.id,
        peer: {
          participantId: participant.id,
          offerer: false,
        },
      });
    }

    return this.joinResult(room, participant, iceServers);
  }

  private async leave(
    definition: LiveRoomDefinition,
    request: RequestContext,
    sessionId?: string,
  ): Promise<void> {
    if (sessionId !== undefined) this.assertId(sessionId, 'sessionId');
    const room = sessionId === undefined
      ? this.rooms.get(this.roomKey(definition, request.route))
      : this.readRoom(definition, request.route, sessionId);
    if (!room) {
      throw new LiveRequestError(404, 'Live session was not found');
    }
    const participant = this.findParticipant(room, request.sender);
    if (!participant) {
      throw new LiveRequestError(403, 'Connection is not a participant in this live room');
    }
    this.removeParticipant(room, participant, 'left');
  }

  private signal(
    definition: LiveRoomDefinition,
    request: RequestContext,
    message: Extract<LiveClientMessage, { action: 'signal' }>,
  ): void {
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

    const room = this.readRoom(definition, request.route, message.sessionId);
    const sender = this.findParticipant(room, request.sender);
    if (!sender) {
      throw new LiveRequestError(403, 'Connection is not a participant in this live room');
    }
    if (sender.id === message.targetParticipantId) {
      throw new LiveRequestError(400, 'Cannot send a live signal to the same participant');
    }

    const target = room.participants.get(message.targetParticipantId);
    if (!target) {
      throw new LiveRequestError(404, 'Target live participant was not found');
    }

    const previousSequence = sender.signalSequences.get(message.attemptId) ?? -1;
    if (message.sequence <= previousSequence) {
      return;
    }
    if (message.sequence !== previousSequence + 1) {
      throw new LiveRequestError(409, 'Live signals must be sent in sequence');
    }
    sender.signalSequences.set(message.attemptId, message.sequence);
    if (sender.signalSequences.size > 16) {
      const oldestAttempt = sender.signalSequences.keys().next().value;
      if (oldestAttempt) sender.signalSequences.delete(oldestAttempt);
    }

    this.sendEvent(target.connection, room.path, {
      action: 'signal',
      sessionId: room.id,
      fromParticipantId: sender.id,
      attemptId: message.attemptId,
      sequence: message.sequence,
      signal: message.signal,
    });
  }

  private removeParticipant(
    room: LiveRoom,
    participant: LiveParticipant,
    reason: LiveLeaveReason,
  ): void {
    if (!room.participants.delete(participant.id)) return;
    room.offererId = null;
    for (const peer of room.participants.values()) {
      this.sendEvent(peer.connection, room.path, {
        action: 'peer-left',
        sessionId: room.id,
        participantId: participant.id,
        reason,
      });
    }
    this.runLeaveHook(room, participant, reason);
    if (room.participants.size === 0) {
      this.rooms.delete(room.key);
    }
  }

  private joinResult(
    room: LiveRoom,
    participant: LiveParticipant,
    iceServers: LiveIceServer[],
  ): LiveJoinResult {
    return {
      protocol: 1,
      sessionId: room.id,
      participantId: participant.id,
      path: room.path,
      iceServers,
      peers: [...room.participants.values()]
        .filter((peer) => peer !== participant)
        .map((peer) => ({
          participantId: peer.id,
          offerer: room.offererId === participant.id,
        })),
    };
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

  private readRoom(
    definition: LiveRoomDefinition,
    path: string,
    sessionId: string,
  ): LiveRoom {
    const room = this.rooms.get(this.roomKey(definition, path));
    if (!room || room.id !== sessionId) {
      throw new LiveRequestError(404, 'Live session was not found');
    }
    return room;
  }

  private findParticipant(
    room: LiveRoom,
    connection: ServerConnection,
  ): LiveParticipant | undefined {
    return [...room.participants.values()].find(
      (participant) => participant.connection === connection,
    );
  }

  private roomContext(request: RequestContext): LiveRoomContext {
    return {
      connection: request.sender,
      path: request.route,
      params: { ...request.params },
    };
  }

  private participantContext(
    room: LiveRoom,
    participant: LiveParticipant,
  ): LiveRoomParticipantContext {
    return {
      connection: participant.connection,
      path: room.path,
      params: { ...room.params },
      sessionId: room.id,
      participantId: participant.id,
    };
  }

  private runLeaveHook(
    room: LiveRoom,
    participant: LiveParticipant,
    reason: LiveLeaveReason,
  ): void {
    const context: LiveRoomLeaveContext = {
      ...this.participantContext(room, participant),
      reason,
    };
    void Promise.resolve(room.definition.options.onLeave?.(context)).catch((error) => {
      console.error(`Live room leave hook failed for "${room.path}"`, error);
    });
  }

  private async resolveIceServers(
    definition: LiveRoomDefinition,
    context: LiveRoomContext,
  ): Promise<LiveIceServer[]> {
    const configured = typeof definition.options.iceServers === 'function'
      ? await definition.options.iceServers(context)
      : definition.options.iceServers || [];
    if (!Array.isArray(configured) || configured.length > MAX_ICE_SERVERS) {
      throw new LiveRequestError(500, 'Live room returned invalid ICE server configuration');
    }
    for (const server of configured) {
      const urls = server?.urls;
      if (
        !(typeof urls === 'string' && urls.length > 0)
        && !(Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === 'string' && url.length > 0))
      ) {
        throw new LiveRequestError(500, 'Live room returned invalid ICE server URLs');
      }
    }
    return configured.map((server) => ({ ...server }));
  }

  private validateSignal(signal: LiveSignal): void {
    if (!signal || typeof signal !== 'object') {
      throw new LiveRequestError(400, 'Live signal must be an object');
    }
    if (signal.type === 'description') {
      if (
        !signal.description
        || (signal.description.type !== 'offer' && signal.description.type !== 'answer')
        || typeof signal.description.sdp !== 'string'
        || signal.description.sdp.length === 0
        || signal.description.sdp.length > MAX_SDP_LENGTH
      ) {
        throw new LiveRequestError(400, 'Invalid live session description');
      }
      return;
    }
    if (signal.type === 'candidate') {
      if (
        !signal.candidate
        || typeof signal.candidate.candidate !== 'string'
        || signal.candidate.candidate.length === 0
        || signal.candidate.candidate.length > MAX_CANDIDATE_LENGTH
      ) {
        throw new LiveRequestError(400, 'Invalid live ICE candidate');
      }
      return;
    }
    if (signal.type !== 'candidates-complete') {
      throw new LiveRequestError(400, 'Invalid live end-of-candidates signal');
    }
  }

  private assertId(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
      throw new LiveRequestError(400, `Invalid ${field}`);
    }
  }

  private sendEvent(
    connection: ServerConnection,
    path: string,
    event: LiveServerEvent,
  ): void {
    connection.sendToRouteAfterReconnect(path, 'LIVE', event as unknown as Payload);
  }

  private roomKey(definition: LiveRoomDefinition, path: string): string {
    return `${definition.route}\n${path}`;
  }

  private async enqueueJoin<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.joinQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    this.joinQueues.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.joinQueues.get(key) === tail) this.joinQueues.delete(key);
    }
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new LiveRequestError(503, 'Live room closed while the request was in progress');
    }
  }
}

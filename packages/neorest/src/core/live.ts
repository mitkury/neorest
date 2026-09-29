import type { ServerConnection } from './ServerConnection';

export interface LiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LiveSessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface LiveIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type LiveSignal =
  | {
      type: 'description';
      description: LiveSessionDescription;
    }
  | {
      type: 'candidate';
      candidate: LiveIceCandidate;
    }
  | {
      type: 'candidates-complete';
    };

export type LiveClientMessage =
  | {
      action: 'join';
    }
  | {
      action: 'leave';
      /** Omitted to cancel an in-flight join on this connection and path. */
      sessionId?: string;
    }
  | {
      action: 'signal';
      sessionId: string;
      targetParticipantId: string;
      attemptId: string;
      sequence: number;
      signal: LiveSignal;
    };

export type LiveServerEvent =
  | {
      action: 'peer-joined';
      sessionId: string;
      peer: LivePeerInfo;
    }
  | {
      action: 'peer-left';
      sessionId: string;
      participantId: string;
      reason: LiveLeaveReason;
    }
  | {
      action: 'signal';
      sessionId: string;
      fromParticipantId: string;
      attemptId: string;
      sequence: number;
      signal: LiveSignal;
    }
  | {
      action: 'session-closed';
      sessionId: string;
      reason: LiveLeaveReason;
    };

export interface LivePeerInfo {
  participantId: string;
  /** The joining peer creates the offer for this peer relationship. */
  offerer: boolean;
}

export interface LiveJoinResult {
  /** Version of the live signaling payloads used after this join. */
  protocol: 1;
  sessionId: string;
  participantId: string;
  path: string;
  iceServers: LiveIceServer[];
  peers: LivePeerInfo[];
}

export type LiveLeaveReason =
  | 'left'
  | 'connection-closed'
  | 'server-closed'
  | 'peer-failed';

export interface LiveRoomAuthorizationResult {
  allowed: boolean;
  status?: number;
  error?: string;
}

export interface LiveRoomContext {
  connection: ServerConnection;
  path: string;
  params: Record<string, string>;
}

export interface LiveRoomParticipantContext extends LiveRoomContext {
  sessionId: string;
  participantId: string;
}

export interface LiveRoomLeaveContext extends LiveRoomParticipantContext {
  reason: LiveLeaveReason;
}

export interface LiveRoomOptions {
  /** One-to-one rooms are the only topology currently supported. */
  maxParticipants?: 2;
  authorize?: (
    context: LiveRoomContext,
  ) =>
    | boolean
    | LiveRoomAuthorizationResult
    | Promise<boolean | LiveRoomAuthorizationResult>;
  iceServers?:
    | LiveIceServer[]
    | ((context: LiveRoomContext) => LiveIceServer[] | Promise<LiveIceServer[]>);
  onJoin?: (context: LiveRoomParticipantContext) => void | Promise<void>;
  onLeave?: (context: LiveRoomLeaveContext) => void | Promise<void>;
}

/** Creates the server-side WebRTC peer used by a live route. */
export type LivePeerConnectionFactory = (
  configuration: RTCConfiguration,
) => RTCPeerConnection;

/**
 * Application-facing view of the server WebRTC peer. Neorest owns signaling
 * and connection lifecycle; the application owns what media and data mean.
 */
export interface LiveServerPeer {
  /** Advanced escape hatch for provider-specific operations and diagnostics. */
  readonly connection: RTCPeerConnection;
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender;
  addTransceiver(
    trackOrKind: MediaStreamTrack | 'audio' | 'video',
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver;
  createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel;
  onTrack(listener: (event: RTCTrackEvent) => void): () => void;
  onDataChannel(listener: (channel: RTCDataChannel) => void): () => void;
  getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport>;
}

export interface LiveServerSessionContext extends LiveRoomParticipantContext {
  peer: LiveServerPeer;
}

export interface LiveServerCloseContext extends LiveServerSessionContext {
  reason: LiveLeaveReason;
}

/** A client-to-server WebRTC route. This is the default live topology. */
export interface LiveServerOptions {
  authorize?: LiveRoomOptions['authorize'];
  iceServers?: LiveRoomOptions['iceServers'];
  /** Extra server peer configuration. `iceServers` is supplied by Neorest. */
  rtcConfiguration?: Omit<RTCConfiguration, 'iceServers'>;
  /** Grace before waiting for an ICE-restart offer. Defaults to 8 seconds. */
  disconnectedGraceMs?: number;
  /** Time allowed for the client to capture media and send its first offer. Defaults to 60 seconds. */
  offerTimeoutMs?: number;
  /** Time allowed for initial negotiation or recovery. Defaults to 20 seconds. */
  negotiationTimeoutMs?: number;
  /** Configure media tracks, sinks, sources, and data-channel listeners. */
  open?: (
    context: LiveServerSessionContext,
  ) => void | Promise<void>;
  onClose?: (
    context: LiveServerCloseContext,
  ) => void | Promise<void>;
}

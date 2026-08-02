// Export main client class
export { Client } from './Client';
export { LiveSession } from './LiveSession';
export type { LiveOptions, LiveSessionState } from './LiveSession';

// Export transports for advanced usage
export { WebSocketTransport } from './transports/WebSocketTransport';
export { WebTransportTransport } from './transports/WebTransportTransport';
export { HttpTransport } from './transports/HttpTransport';
export { AutoTransport } from './transports/AutoTransport';
export { createTransport } from './transports';

// Export connection class for advanced usage
export { ClientConnection } from './ClientConnection';

// Re-export types from core
export type {
  RouteResponse,
  Payload,
  RouteVerb,
  BroadcastEvent,
  ConnectionOptions,
  ReconnectOptions,
  MsgID,
  MsgType,
  MsgWrapper,
  ConnectionSecret,
  TransportKind,
  TransportMode,
  WebTransportCertificateHash,
  WebTransportClientOptions,
  LiveIceServer,
  LivePeerConnectionFactory,
  LiveServerOptions,
  LiveServerPeer,
  LiveServerSessionContext,
  LiveServerCloseContext,
  LiveRoomOptions,
  LiveRoomContext,
  LiveRoomParticipantContext,
  LiveRoomLeaveContext,
} from './core';

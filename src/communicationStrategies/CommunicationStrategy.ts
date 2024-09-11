import { MsgWrapper, RouteResponse, MsgType } from "../types.ts";

export interface CommunicationStrategy {
  connect(): Promise<void>;
  disconnect(): void;
  send(message: MsgWrapper): void;
  onMessage(callback: (message: MsgWrapper) => void): void;
  onClose(callback: () => void): void;
  onOpen(callback: () => void): void;
  isConnected(): boolean;
}
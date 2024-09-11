import { CommunicationStrategy } from "./CommunicationStrategy.ts";
import { MsgWrapper } from "../types.ts";

export class WebSocketStrategy implements CommunicationStrategy {
  private socket: WebSocket | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;

  constructor(private url: string) {}

  async connect(): Promise<void> {
    this.socket = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      this.socket!.onopen = () => resolve();
      this.socket!.onerror = (error) => reject(error);
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  send(message: MsgWrapper): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      throw new Error("WebSocket is not connected");
    }
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
    if (this.socket) {
      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as MsgWrapper;
        this.messageCallback!(message);
      };
    }
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
    if (this.socket) {
      this.socket.onclose = () => {
        if (this.closeCallback) this.closeCallback();
      };
    }
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
    if (this.socket) {
      this.socket.onopen = () => {
        if (this.openCallback) this.openCallback();
      };
    }
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
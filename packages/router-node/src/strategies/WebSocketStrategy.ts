import type { ServerStrategy, MsgWrapper } from '@neorest/core';
import { WebSocket } from 'ws';

/**
 * WebSocket strategy for Node.js server using 'ws'
 */
export class WebSocketStrategy implements ServerStrategy {
  private socket: WebSocket;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connected = false;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.setupSocketHandlers();
    this.connected = this.socket.readyState === WebSocket.OPEN;
  }

  private setupSocketHandlers(): void {
    this.socket.on('open', () => {
      this.connected = true;
      if (this.openCallback) this.openCallback();
    });

    this.socket.on('close', () => {
      this.connected = false;
      if (this.closeCallback) this.closeCallback();
    });

    this.socket.on('message', (data: Buffer) => {
      if (!this.messageCallback) return;
      try {
        const message = JSON.parse(data.toString()) as MsgWrapper;
        this.messageCallback(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      try { this.socket.close(); } catch {}
    });
  }

  async connect(): Promise<void> {
    // Already connected by the time we construct from upgrade
    if (this.connected && this.openCallback) this.openCallback();
  }

  disconnect(): void {
    try { this.socket.close(); } catch {}
    this.connected = false;
  }

  send(message: MsgWrapper): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending message:', error);
        this.disconnect();
      }
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
    if (this.connected) callback();
  }

  isConnected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  handleConnection(connection: WebSocket): void {
    this.socket = connection;
    this.setupSocketHandlers();
  }

  broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void {
    if (!filter || filter(this.socket)) {
      this.send(message);
    }
  }
}



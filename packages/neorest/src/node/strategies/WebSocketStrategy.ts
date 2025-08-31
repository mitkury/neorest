import type { ServerStrategy, MsgWrapper } from '../../core';
import type { WebSocket as WsServerSocket } from 'ws';

/**
 * WebSocket strategy for Node.js server using 'ws'.
 * Uses EventEmitter-style 'on' handlers.
 */
export class WebSocketStrategy implements ServerStrategy {
  private socket: WsServerSocket;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;

  constructor(socket: WsServerSocket) {
    this.socket = socket;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    // Only call open callback when the socket is confirmed open
    if ((this.socket as any).readyState === 1 && this.openCallback) {
      this.openCallback();
    }

    this.socket.on('open', () => {
      if (this.openCallback) this.openCallback();
    });

    this.socket.on('close', () => {
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

    this.socket.on('error', (error: unknown) => {
      console.error('WebSocket error:', error);
      try { this.socket.close(); } catch {}
    });
  }

  async connect(): Promise<void> {
    if ((this.socket as any).readyState === 1 && this.openCallback) this.openCallback();
  }

  disconnect(): void {
    try { this.socket.close(); } catch {}
  }

  send(message: MsgWrapper): void {
    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message:', error);
      this.disconnect();
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
  }

  isConnected(): boolean {
    // ws uses readyState numbers; 1 is OPEN
    return (this.socket as any).readyState === 1;
  }

  handleConnection(connection: WsServerSocket): void {
    this.socket = connection;
    this.setupSocketHandlers();
  }

  updateSocket(newSocket: WsServerSocket): void {
    // Disconnect the old socket
    try { this.socket.close(); } catch {}
    
    // Update to the new socket
    this.socket = newSocket;
    this.setupSocketHandlers();
  }

  broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void {
    if (!filter || filter(this.socket)) {
      this.send(message);
    }
  }
}



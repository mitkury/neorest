import { ClientStrategy, MsgWrapper, ConnectionInfo } from '../core';

/**
 * WebSocket-based communication strategy using standard browser API
 */
export class WebSocketStrategy implements ClientStrategy {
  private socket: WebSocket | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connectionInfo: ConnectionInfo;
  private authData: Record<string, string> = {};
  private isNode: boolean = false;

  /**
   * Constructor
   * @param url - The URL to connect to
   */
  constructor(url: string) {
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url,
      type: 'websocket',
      status: 'disconnected'
    };
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    // Add auth data to URL if provided
    let connectionUrl = this.connectionInfo.url;
    if (Object.keys(this.authData).length > 0) {
      const urlObj = new URL(connectionUrl);
      for (const [key, value] of Object.entries(this.authData)) {
        urlObj.searchParams.set(key, value);
      }
      connectionUrl = urlObj.toString();
    }
    
    // Create WebSocket in browser or Node
    let ctor: any = (globalThis as any).WebSocket;
    if (!ctor) {
      try { ctor = require('ws'); this.isNode = true; } catch {}
    }
    this.socket = new ctor(connectionUrl) as any;
    this.connectionInfo.status = 'connecting';
    
    // Set up handlers
    this.setupSocketHandlers();
    
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("WebSocket not initialized"));
        return;
      }
      
      const onOpenHandler = () => {
        this.connectionInfo.status = 'connected';
        resolve();
        if (this.socket) {
          if (this.isNode) (this.socket as any).off?.('open', onOpenHandler); else (this.socket as any).removeEventListener?.('open', onOpenHandler);
        }
      };
      
      const onErrorHandler = () => {
        this.connectionInfo.status = 'disconnected';
        reject(new Error("WebSocket connection failed"));
        if (this.socket) {
          if (this.isNode) (this.socket as any).off?.('error', onErrorHandler); else (this.socket as any).removeEventListener?.('error', onErrorHandler);
        }
      };
      
      if (this.isNode) {
        (this.socket as any).on('open', onOpenHandler);
        (this.socket as any).on('error', onErrorHandler);
      } else {
        (this.socket as any).addEventListener('open', onOpenHandler);
        (this.socket as any).addEventListener('error', onErrorHandler);
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (error) {
        console.error("Error closing WebSocket:", error);
      }
      this.socket = null;
    }
    
    this.connectionInfo.status = 'disconnected';
  }

  /**
   * Send a message to the server
   * @param message - The message to send
   */
  send(message: MsgWrapper): void {
    const ready = this.isNode ? ((this.socket as any)?.readyState === 1) : (this.socket?.readyState === WebSocket.OPEN);
    if (ready) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
        this.disconnect();
      }
    } else {
      throw new Error("WebSocket is not connected");
    }
  }

  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
    if (this.socket) {
      if (this.isNode) {
        const handler = (data: any) => {
          try { const text = Buffer.isBuffer(data) ? data.toString() : String(data); const parsed = JSON.parse(text) as MsgWrapper; this.messageCallback!(parsed); } catch (e) { console.error("Error parsing message:", e); }
        };
        (this.socket as any).off?.('message', (this as any)._msgHandler);
        (this as any)._msgHandler = handler;
        (this.socket as any).on('message', handler);
      } else {
        const handler = (event: MessageEvent) => {
          try { const data = JSON.parse((event.data as any) as string) as MsgWrapper; this.messageCallback!(data); } catch (e) { console.error("Error parsing message:", e); }
        };
        (this.socket as any).addEventListener('message', handler);
      }
    }
  }

  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
    if (this.socket) {
      const handler = () => { this.connectionInfo.status = 'disconnected'; this.closeCallback!(); };
      if (this.isNode) { (this.socket as any).off?.('close', (this as any)._closeHandler); (this as any)._closeHandler = handler; (this.socket as any).on('close', handler); }
      else { (this.socket as any).addEventListener('close', handler); }
    }
  }

  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback: () => void): void {
    this.openCallback = callback;
    if (this.socket) {
      const handler = () => { this.connectionInfo.status = 'connected'; this.openCallback!(); };
      if (this.isNode) { (this.socket as any).off?.('open', (this as any)._openHandler); (this as any)._openHandler = handler; (this.socket as any).on('open', handler); }
      else { (this.socket as any).addEventListener('open', handler); }
    }
  }

  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.isNode ? ((this.socket as any)?.readyState === 1) : (this.socket?.readyState === WebSocket.OPEN);
  }

  /**
   * Set authentication data
   * @param authData - The authentication data
   */
  setAuthentication(authData: Record<string, string>): void {
    this.authData = authData;
  }

  /**
   * Get information about the connection
   * @returns Connection information
   */
  getConnectionInfo(): ConnectionInfo {
    return this.connectionInfo;
  }
  
  /**
   * Set up socket handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;
    // Error handler
    if (this.isNode) (this.socket as any).on('error', (e: any) => console.error('WebSocket error:', e));
    else (this.socket as any).addEventListener('error', (e: any) => console.error('WebSocket error:', e));
  }
}
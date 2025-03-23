import { CommunicationStrategy, MsgWrapper, ClientStrategy, ConnectionInfo } from '@neorest/core';

/**
 * WebSocket-based communication strategy
 */
export class WebSocketStrategy implements ClientStrategy {
  private socket: WebSocket | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connectionInfo: ConnectionInfo;
  private authData: Record<string, string> = {};

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
    
    this.socket = new WebSocket(connectionUrl);
    this.connectionInfo.status = 'connecting';
    
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("WebSocket not initialized"));
        return;
      }
      
      this.socket.onopen = () => {
        this.connectionInfo.status = 'connected';
        resolve();
      };
      
      this.socket.onerror = (error) => {
        this.connectionInfo.status = 'disconnected';
        reject(error);
      };
      
      // Set up other handlers
      if (this.openCallback) {
        this.socket.onopen = () => {
          this.connectionInfo.status = 'connected';
          if (this.openCallback) this.openCallback();
          resolve();
        };
      }
      
      if (this.messageCallback) {
        this.socket.onmessage = (event) => {
          const message = JSON.parse(event.data) as MsgWrapper;
          this.messageCallback!(message);
        };
      }
      
      if (this.closeCallback) {
        this.socket.onclose = () => {
          this.connectionInfo.status = 'disconnected';
          if (this.closeCallback) this.closeCallback();
        };
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.connectionInfo.status = 'disconnected';
  }

  /**
   * Send a message to the server
   * @param message - The message to send
   */
  send(message: MsgWrapper): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
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
      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as MsgWrapper;
        this.messageCallback!(message);
      };
    }
  }

  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
    if (this.socket) {
      this.socket.onclose = () => {
        this.connectionInfo.status = 'disconnected';
        if (this.closeCallback) this.closeCallback();
      };
    }
  }

  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback: () => void): void {
    this.openCallback = callback;
    if (this.socket) {
      this.socket.onopen = () => {
        this.connectionInfo.status = 'connected';
        if (this.openCallback) this.openCallback();
      };
    }
  }

  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
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
}
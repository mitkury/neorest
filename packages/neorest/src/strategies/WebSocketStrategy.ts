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
    // Create WebSocket
    this.socket = new WebSocket(connectionUrl);
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
        // Clean up the temporary handler
        if (this.socket) this.socket.removeEventListener('open', onOpenHandler);
      };
      
      const onErrorHandler = (event: Event) => {
        this.connectionInfo.status = 'disconnected';
        reject(new Error("WebSocket connection failed"));
        // Clean up the temporary handler
        if (this.socket) this.socket.removeEventListener('error', onErrorHandler);
      };
      
      this.socket.addEventListener('open', onOpenHandler);
      this.socket.addEventListener('error', onErrorHandler);
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
    if (this.socket?.readyState === WebSocket.OPEN) {
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
      // Remove any existing listener
      const oldListener = this.socket.onmessage;
      if (oldListener) {
        this.socket.removeEventListener('message', oldListener as any);
      }
      
      // Add new listener
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as MsgWrapper;
          this.messageCallback!(data);
        } catch (error) {
          console.error("Error parsing message:", error);
        }
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
      // Remove any existing listener
      const oldListener = this.socket.onclose;
      if (oldListener) {
        this.socket.removeEventListener('close', oldListener as any);
      }
      
      // Add new listener
      this.socket.onclose = () => {
        this.connectionInfo.status = 'disconnected';
        this.closeCallback!();
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
      // Remove any existing listener
      const oldListener = this.socket.onopen;
      if (oldListener) {
        this.socket.removeEventListener('open', oldListener as any);
      }
      
      // Add new listener
      this.socket.onopen = () => {
        this.connectionInfo.status = 'connected';
        this.openCallback!();
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
  
  /**
   * Set up socket handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;
    
    // Set up message handler
    if (this.messageCallback) {
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as MsgWrapper;
          this.messageCallback!(data);
        } catch (error) {
          console.error("Error parsing message:", error);
        }
      };
    }
    
    // Set up close handler
    if (this.closeCallback) {
      this.socket.onclose = () => {
        this.connectionInfo.status = 'disconnected';
        this.closeCallback!();
      };
    }
    
    // Set up open handler
    if (this.openCallback) {
      this.socket.onopen = () => {
        this.connectionInfo.status = 'connected';
        this.openCallback!();
      };
    }
    
    // Set up error handler
    this.socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }
}
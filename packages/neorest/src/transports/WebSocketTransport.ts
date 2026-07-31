import { ClientTransport, MsgWrapper, ConnectionInfo } from '../core';

/**
 * WebSocket-based communication transport using standard browser API
 */
export class WebSocketTransport implements ClientTransport {
  private socket: WebSocket | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connectionInfo: ConnectionInfo;
  private authData: Record<string, string> = {};
  private isClosing = false;

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
    this.isClosing = false;
    // Add auth data to URL if provided
    const transportUrl = new URL(this.connectionInfo.url);
    transportUrl.pathname = '/.neorest';
    let connectionUrl = transportUrl.toString();
    if (Object.keys(this.authData).length > 0) {
      const urlObj = new URL(connectionUrl);
      for (const [key, value] of Object.entries(this.authData)) {
        urlObj.searchParams.set(key, value);
      }
      connectionUrl = urlObj.toString();
    }
    // Create WebSocket
    const socket = new WebSocket(connectionUrl);
    this.socket = socket;
    this.connectionInfo.status = 'connecting';
    
    // Set up handlers
    this.setupSocketHandlers(socket);
    
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener('open', onOpenHandler);
        socket.removeEventListener('error', onErrorHandler);
        socket.removeEventListener('close', onCloseHandler);
      };
      const onOpenHandler = () => {
        if (this.socket !== socket) return;
        this.connectionInfo.status = 'connected';
        cleanup();
        resolve();
      };
      
      const onErrorHandler = () => {
        if (this.socket !== socket) return;
        this.connectionInfo.status = 'disconnected';
        cleanup();
        reject(new Error("WebSocket connection failed"));
      };

      const onCloseHandler = () => {
        cleanup();
        if (this.socket === socket) {
          this.socket = null;
          this.connectionInfo.status = 'disconnected';
        }
        reject(new Error("WebSocket closed before the connection was established"));
      };
      
      socket.addEventListener('open', onOpenHandler);
      socket.addEventListener('error', onErrorHandler);
      socket.addEventListener('close', onCloseHandler);
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.isClosing = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch (error) {
        console.error("Error closing WebSocket:", error);
      }
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

  getConnectionMode(): 'websocket' {
    return 'websocket';
  }
  
  /**
   * Set up socket handlers
   */
  private setupSocketHandlers(socket: WebSocket): void {
    // Set up message handler
    if (this.messageCallback) {
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
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
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.connectionInfo.status = 'disconnected';
        this.closeCallback!();
      };
    }
    
    // Set up open handler
    if (this.openCallback) {
      socket.onopen = () => {
        if (this.socket !== socket) return;
        this.connectionInfo.status = 'connected';
        this.openCallback!();
      };
    }
    
    // Set up error handler
    socket.onerror = (error) => {
      if (this.socket === socket && !this.isClosing) {
        console.error("WebSocket error:", error);
      }
    };
  }
}

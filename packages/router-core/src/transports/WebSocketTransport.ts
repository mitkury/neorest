import { ServerTransport, MsgWrapper } from '@neorest/core';

/**
 * WebSocket transport for server-side connections using standard browser WebSocket API.
 * Can be used in both Node.js and Deno environments.
 */
export class WebSocketTransport implements ServerTransport {
  private socket: WebSocket;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connected = false;

  /**
   * Constructor
   * @param socket - The WebSocket connection
   */
  constructor(socket: WebSocket) {
    this.socket = socket;
    this.setupSocketHandlers();
    
    // Check if the socket is already open
    if (this.socket.readyState === WebSocket.OPEN) {
      this.connected = true;
    }
  }

  /**
   * Set up socket handlers
   */
  private setupSocketHandlers(): void {
    // Use addEventListener if available (more reliable across environments)
    if (typeof this.socket.addEventListener === 'function') {
      this.socket.addEventListener('open', () => {
        this.connected = true;
        if (this.openCallback) {
          this.openCallback();
        }
      });

      this.socket.addEventListener('close', () => {
        this.connected = false;
        if (this.closeCallback) {
          this.closeCallback();
        }
      });

      this.socket.addEventListener('message', (event) => {
        if (this.messageCallback) {
          try {
            const message = JSON.parse(event.data as string) as MsgWrapper;
            this.messageCallback(message);
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        }
      });

      this.socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        // Close the connection on error
        this.socket.close();
      });
    } else {
      // Fall back to onX properties for older environments
      this.socket.onopen = () => {
        this.connected = true;
        if (this.openCallback) {
          this.openCallback();
        }
      };

      this.socket.onclose = () => {
        this.connected = false;
        if (this.closeCallback) {
          this.closeCallback();
        }
      };

      this.socket.onmessage = (event) => {
        if (this.messageCallback) {
          try {
            const message = JSON.parse(event.data as string) as MsgWrapper;
            this.messageCallback(message);
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        }
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Close the connection on error
        this.socket.close();
      };
    }
  }

  /**
   * Connect to the client
   */
  async connect(): Promise<void> {
    // For server-side WebSockets, the socket is already connected
    // Just make sure we mark it as connected and call the open callback
    this.connected = this.socket.readyState === WebSocket.OPEN;
    
    if (this.connected && this.openCallback) {
      this.openCallback();
    }
    
    return Promise.resolve();
  }

  /**
   * Disconnect from the client
   */
  disconnect(): void {
    try {
      this.socket.close();
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
    this.connected = false;
  }

  /**
   * Send a message to the client
   * @param message - The message to send
   */
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

  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback: () => void): void {
    this.openCallback = callback;
    // If already connected, call the callback immediately
    if (this.connected) {
      callback();
    }
  }

  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Handle a new connection
   * @param connection - The connection to handle
   */
  handleConnection(connection: WebSocket): void {
    this.socket = connection;
    this.setupSocketHandlers();
  }

  /**
   * Broadcast a message to all connections
   * @param message - The message to broadcast
   * @param filter - Optional filter function to determine which connections receive the message
   */
  broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void {
    // This is a single connection transport, so broadcasting is the same as sending
    if (!filter || filter(this.socket)) {
      this.send(message);
    }
  }
}

import { ServerStrategy, MsgWrapper, ConnectionSecret } from '../../../../core/src/index.ts';

/**
 * HTTP long-polling strategy for Deno server
 */
export class HttpStrategy implements ServerStrategy {
  private clientId: string;
  private messageQueue: MsgWrapper[] = [];
  private lastPollTime: number = Date.now();
  private active: boolean = true;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private timeoutId: number | null = null;
  private timeoutDuration = 30000; // 30 seconds timeout for inactive connections
  
  /**
   * Constructor
   * @param clientId - The client ID
   */
  constructor(clientId: string) {
    this.clientId = clientId;
    this.startInactivityTimer();
  }

  /**
   * Start a timer to detect inactive connections
   */
  private startInactivityTimer(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    
    this.timeoutId = setTimeout(() => {
      if (Date.now() - this.lastPollTime > this.timeoutDuration) {
        console.log(`HTTP client ${this.clientId} inactive, disconnecting`);
        this.disconnect();
      } else {
        this.startInactivityTimer();
      }
    }, this.timeoutDuration) as unknown as number;
  }

  /**
   * Connect (no-op for HTTP server strategy, connection is established on construction)
   */
  async connect(): Promise<void> {
    this.active = true;
    return Promise.resolve();
  }

  /**
   * Disconnect this client
   */
  disconnect(): void {
    this.active = false;
    this.messageQueue = [];
    
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    if (this.closeCallback) {
      this.closeCallback();
    }
  }

  /**
   * Send a message to the client (stored for next poll)
   * @param message - The message to send
   */
  send(message: MsgWrapper): void {
    if (this.active) {
      this.messageQueue.push({ ...message }); // Clone to avoid reference issues
    }
  }

  /**
   * Get all queued messages and clear the queue
   * @returns The queued messages
   */
  getQueuedMessages(): MsgWrapper[] {
    this.lastPollTime = Date.now();
    this.startInactivityTimer();
    
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  /**
   * Process an incoming message from the client
   * @param message - The message to process
   */
  processMessage(message: MsgWrapper): void {
    this.lastPollTime = Date.now();
    this.startInactivityTimer();
    
    if (this.messageCallback) {
      this.messageCallback(message);
    }
  }

  /**
   * Check if this connection is active
   * @returns True if active, false otherwise
   */
  isConnected(): boolean {
    return this.active;
  }

  /**
   * Register a callback for incoming messages
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
    // Call immediately since HTTP connections are established on construction
    callback();
  }

  /**
   * Get the client ID
   * @returns The client ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * Handle a broadcast message
   * @param message - The message to broadcast
   * @param filter - Optional filter function
   */
  broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void {
    // This is a single connection strategy, so broadcasting is the same as sending
    if (!filter || filter(this)) {
      this.send(message);
    }
  }
}
import { MsgWrapper } from '../types';
import { ServerTransport } from '../CommunicationTransport';

/**
 * Base HTTP long-polling transport for server implementations.
 * This provides common functionality for HTTP transports across platforms.
 */
export abstract class HttpTransportBase implements ServerTransport {
  protected clientId: string;
  protected messageQueue: MsgWrapper[] = [];
  protected lastPollTime: number = Date.now();
  protected active: boolean = true;
  protected messageCallback: ((message: MsgWrapper) => void) | null = null;
  protected closeCallback: (() => void) | null = null;
  protected timeoutId: number | null = null;
  protected timeoutDuration: number;
  private pendingPoll: {
    resolve: (messages: MsgWrapper[]) => void;
    timer: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    onAbort?: () => void;
  } | null = null;
  
  /**
   * Constructor
   * @param clientId - The client ID
   * @param timeoutDuration - Inactivity timeout in milliseconds
   */
  constructor(clientId: string, timeoutDuration = 30_000) {
    this.clientId = clientId;
    this.timeoutDuration = timeoutDuration;
    this.startInactivityTimer();
  }

  /**
   * HTTP long-polling transport is per-connection and does not accept an external connection object.
   * Implementing to satisfy the ServerTransport interface.
   */
  handleConnection(_: any): void {
    // No-op for HTTP transport
  }

  /**
   * Start a timer to detect inactive connections
   */
  protected startInactivityTimer(): void {
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
   * Connect (no-op for HTTP server transport, connection is established on construction)
   */
  async connect(): Promise<void> {
    this.active = true;
    return Promise.resolve();
  }

  /**
   * Disconnect this client
   */
  disconnect(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.messageQueue = [];
    this.finishPendingPoll([]);
    
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
      if (this.pendingPoll) {
        this.finishPendingPoll(this.takeQueuedMessages());
      }
    }
  }

  /**
   * Get all queued messages and clear the queue
   * @returns The queued messages
   */
  getQueuedMessages(): MsgWrapper[] {
    if (!this.active) {
      return [];
    }
    this.lastPollTime = Date.now();
    this.startInactivityTimer();
    
    return this.takeQueuedMessages();
  }

  /**
   * Hold a poll until messages are available, the request is aborted, or the
   * timeout expires. Only one poll is retained per HTTP transport.
   */
  waitForMessages(timeoutMs: number, signal?: AbortSignal): Promise<MsgWrapper[]> {
    if (!this.active || signal?.aborted) {
      return Promise.resolve([]);
    }
    const queued = this.getQueuedMessages();
    if (queued.length > 0) {
      return Promise.resolve(queued);
    }

    // A replacement poll supersedes an older browser request for the same
    // logical transport, preventing unbounded pending responses.
    if (this.pendingPoll) {
      this.finishPendingPoll([]);
    }

    this.lastPollTime = Date.now();
    this.startInactivityTimer();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finishPendingPoll([]);
      }, timeoutMs);
      const onAbort = () => {
        this.finishPendingPoll([]);
      };
      this.pendingPoll = { resolve, timer, signal, onAbort };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Process an incoming message from the client
   * @param message - The message to process
   */
  processMessage(message: MsgWrapper): void {
    if (!this.active) {
      return;
    }
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
    // This is a single connection transport, so broadcasting is the same as sending
    if (!filter || filter(this)) {
      this.send(message);
    }
  }

  private takeQueuedMessages(): MsgWrapper[] {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  private finishPendingPoll(messages: MsgWrapper[]): void {
    const pending = this.pendingPoll;
    if (!pending) {
      return;
    }
    this.pendingPoll = null;
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    pending.resolve(messages);
  }
}

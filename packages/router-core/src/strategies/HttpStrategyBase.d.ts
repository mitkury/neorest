import { ServerStrategy, MsgWrapper } from '@neorest/core';
/**
 * Base HTTP long-polling strategy for server implementations.
 * This provides common functionality for HTTP strategies across platforms.
 */
export declare abstract class HttpStrategyBase implements ServerStrategy {
    protected clientId: string;
    protected messageQueue: MsgWrapper[];
    protected lastPollTime: number;
    protected active: boolean;
    protected messageCallback: ((message: MsgWrapper) => void) | null;
    protected closeCallback: (() => void) | null;
    protected timeoutId: number | null;
    protected timeoutDuration: number;
    /**
     * Constructor
     * @param clientId - The client ID
     */
    constructor(clientId: string);
    /**
     * HTTP long-polling strategy is per-connection and does not accept an external connection object.
     * Implementing to satisfy the ServerStrategy interface.
     */
    handleConnection(_: any): void;
    /**
     * Start a timer to detect inactive connections
     */
    protected startInactivityTimer(): void;
    /**
     * Connect (no-op for HTTP server strategy, connection is established on construction)
     */
    connect(): Promise<void>;
    /**
     * Disconnect this client
     */
    disconnect(): void;
    /**
     * Send a message to the client (stored for next poll)
     * @param message - The message to send
     */
    send(message: MsgWrapper): void;
    /**
     * Get all queued messages and clear the queue
     * @returns The queued messages
     */
    getQueuedMessages(): MsgWrapper[];
    /**
     * Process an incoming message from the client
     * @param message - The message to process
     */
    processMessage(message: MsgWrapper): void;
    /**
     * Check if this connection is active
     * @returns True if active, false otherwise
     */
    isConnected(): boolean;
    /**
     * Register a callback for incoming messages
     * @param callback - The callback to register
     */
    onMessage(callback: (message: MsgWrapper) => void): void;
    /**
     * Register a callback for when the connection is closed
     * @param callback - The callback to register
     */
    onClose(callback: () => void): void;
    /**
     * Register a callback for when the connection is opened
     * @param callback - The callback to register
     */
    onOpen(callback: () => void): void;
    /**
     * Get the client ID
     * @returns The client ID
     */
    getClientId(): string;
    /**
     * Handle a broadcast message
     * @param message - The message to broadcast
     * @param filter - Optional filter function
     */
    broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void;
}
//# sourceMappingURL=HttpStrategyBase.d.ts.map
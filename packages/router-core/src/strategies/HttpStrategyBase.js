/**
 * Base HTTP long-polling strategy for server implementations.
 * This provides common functionality for HTTP strategies across platforms.
 */
export class HttpStrategyBase {
    /**
     * Constructor
     * @param clientId - The client ID
     */
    constructor(clientId) {
        this.messageQueue = [];
        this.lastPollTime = Date.now();
        this.active = true;
        this.messageCallback = null;
        this.closeCallback = null;
        this.timeoutId = null;
        this.timeoutDuration = 30000; // 30 seconds timeout for inactive connections
        this.clientId = clientId;
        this.startInactivityTimer();
    }
    /**
     * HTTP long-polling strategy is per-connection and does not accept an external connection object.
     * Implementing to satisfy the ServerStrategy interface.
     */
    handleConnection(_) {
        // No-op for HTTP strategy
    }
    /**
     * Start a timer to detect inactive connections
     */
    startInactivityTimer() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        this.timeoutId = setTimeout(() => {
            if (Date.now() - this.lastPollTime > this.timeoutDuration) {
                console.log(`HTTP client ${this.clientId} inactive, disconnecting`);
                this.disconnect();
            }
            else {
                this.startInactivityTimer();
            }
        }, this.timeoutDuration);
    }
    /**
     * Connect (no-op for HTTP server strategy, connection is established on construction)
     */
    async connect() {
        this.active = true;
        return Promise.resolve();
    }
    /**
     * Disconnect this client
     */
    disconnect() {
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
    send(message) {
        if (this.active) {
            this.messageQueue.push({ ...message }); // Clone to avoid reference issues
        }
    }
    /**
     * Get all queued messages and clear the queue
     * @returns The queued messages
     */
    getQueuedMessages() {
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
    processMessage(message) {
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
    isConnected() {
        return this.active;
    }
    /**
     * Register a callback for incoming messages
     * @param callback - The callback to register
     */
    onMessage(callback) {
        this.messageCallback = callback;
    }
    /**
     * Register a callback for when the connection is closed
     * @param callback - The callback to register
     */
    onClose(callback) {
        this.closeCallback = callback;
    }
    /**
     * Register a callback for when the connection is opened
     * @param callback - The callback to register
     */
    onOpen(callback) {
        // Call immediately since HTTP connections are established on construction
        callback();
    }
    /**
     * Get the client ID
     * @returns The client ID
     */
    getClientId() {
        return this.clientId;
    }
    /**
     * Handle a broadcast message
     * @param message - The message to broadcast
     * @param filter - Optional filter function
     */
    broadcast(message, filter) {
        // This is a single connection strategy, so broadcasting is the same as sending
        if (!filter || filter(this)) {
            this.send(message);
        }
    }
}
//# sourceMappingURL=HttpStrategyBase.js.map
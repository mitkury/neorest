import { ServerStrategy, MsgWrapper } from '@neorest/core';
/**
 * WebSocket strategy for server-side connections using standard browser WebSocket API.
 * Can be used in both Node.js and Deno environments.
 */
export declare class WebSocketStrategy implements ServerStrategy {
    private socket;
    private messageCallback;
    private closeCallback;
    private openCallback;
    private connected;
    /**
     * Constructor
     * @param socket - The WebSocket connection
     */
    constructor(socket: WebSocket);
    /**
     * Set up socket handlers
     */
    private setupSocketHandlers;
    /**
     * Connect to the client
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the client
     */
    disconnect(): void;
    /**
     * Send a message to the client
     * @param message - The message to send
     */
    send(message: MsgWrapper): void;
    /**
     * Register a callback for when a message is received
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
     * Check if the connection is established
     * @returns True if connected, false otherwise
     */
    isConnected(): boolean;
    /**
     * Handle a new connection
     * @param connection - The connection to handle
     */
    handleConnection(connection: WebSocket): void;
    /**
     * Broadcast a message to all connections
     * @param message - The message to broadcast
     * @param filter - Optional filter function to determine which connections receive the message
     */
    broadcast(message: MsgWrapper, filter?: (conn: any) => boolean): void;
}
//# sourceMappingURL=WebSocketStrategy.d.ts.map
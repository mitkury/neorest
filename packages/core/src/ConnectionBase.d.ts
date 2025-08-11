import { CommunicationStrategy } from './CommunicationStrategy';
import { MsgID, MsgType, MsgWrapper, Payload, RouteResponse, MsgResponse } from './types';
import { TrackedPromise } from './utils/TrackedPromise';
/**
 * Pair of a message and its response
 */
interface MessageResponsePair {
    wrapper: MsgWrapper;
    response: TrackedPromise<MsgResponse>;
}
/**
 * Type for message handlers
 */
type MessageHandler = (id: MsgID, msg: MsgType) => Promise<MsgResponse> | MsgResponse | null;
/**
 * Map of message types to handlers
 */
interface MessageHandlerMap {
    [key: string]: MessageHandler;
}
/**
 * Base class for client and server connections
 */
export declare abstract class ConnectionBase {
    protected static RESEND_NOT_ANSWERED_MESSAGES_AFTER_MS: number;
    protected static SEND_LIMIT_PER_SEC: number;
    protected strategy: CommunicationStrategy;
    protected nextMsgId: MsgID;
    protected messagesToAck: {
        wrappedMsg: MsgWrapper;
        sentAt: number;
        sentAmount: number;
    }[];
    protected receivedMessages: MessageResponsePair[];
    protected messagesToSendAfterReconnect: MsgWrapper[];
    protected callbacks: Map<MsgID, (response: RouteResponse<any>) => void>;
    protected messagesSentInASecond: number;
    protected headers: Record<string, Payload>;
    protected messageHandlers: MessageHandlerMap;
    protected closingTimer: ReturnType<typeof setTimeout> | null;
    onOpen: () => void;
    onClose: () => void;
    onDataSet: (data: [string, Payload]) => void;
    /**
     * Constructor
     * @param strategy - The communication strategy to use
     */
    constructor(strategy: CommunicationStrategy);
    /**
     * Connect to the server
     */
    connect(): Promise<void>;
    /**
     * Close the connection
     */
    close(): void;
    /**
     * Set a new communication strategy
     * @param newStrategy - The new strategy to use
     */
    setStrategy(newStrategy: CommunicationStrategy): Promise<void>;
    /**
     * Post a message and register a callback for the response
     * @param msg - The message to post
     * @param callback - The callback to register
     */
    post(msg: MsgType, callback?: (response: RouteResponse<any>) => void): void;
    /**
     * Get a header value
     * @param key - The header key
     * @returns The header value
     */
    getHeader(key: string): Payload | undefined;
    /**
     * Set a header value
     * @param key - The header key
     * @param value - The header value
     */
    setHeader(key: string, value: Payload): void;
    /**
     * Set up rate limiting
     */
    private setupRateLimiting;
    /**
     * Set up event handlers for the strategy
     */
    private setupStrategyHandlers;
    /**
     * Register default message handlers
     */
    protected registerDefaultHandlers(): void;
    /**
     * Handle a socket event
     * @param wrapper - The message wrapper
     */
    private handleSocketEvent;
    /**
     * Handle a message
     * @param wrapper - The message wrapper
     */
    protected handleMessage(wrapper: MsgWrapper): void;
    /**
     * Get a received message pair by ID
     * @param id - The message ID
     * @returns The message pair, or null if not found
     */
    private getReceivedPairById;
    /**
     * Handle a response message
     * @param msg - The response message
     */
    private handleResponse;
    /**
     * Send a message and expect a response
     * @param msg - The message to send
     * @returns The message ID
     */
    protected postAndExpectResponse(msg: MsgType): MsgID;
    /**
     * Send a message and forget about the response
     * @param msgOrPromise - The message to send, or a promise that resolves to a message
     */
    protected postAndForget(msgOrPromise: MsgType | Promise<MsgType>): Promise<void>;
    /**
     * Check if a message needs an acknowledgment
     * @param wrappedMsg - The message wrapper
     * @returns True if the message needs an acknowledgment, false otherwise
     */
    private static messageNeedsAck;
    /**
     * Send a wrapped message
     * @param wrappedMsg - The message wrapper
     * @param sentIdx - The index in the messagesToAck array, or -1 if not in the array
     */
    protected sendWrappedMsg(wrappedMsg: MsgWrapper, sentIdx?: number): void;
    /**
     * Remove a message from the messagesToAck array
     * @param id - The message ID
     */
    private removeMessageToAck;
    /**
     * Send messages that were queued while disconnected
     */
    protected sendMessagesFromLaterList(): void;
    /**
     * Clear the closing timer
     */
    protected clearClosingTimer(): void;
    /**
     * Register a handler for a message type
     * @param type - The message type
     * @param handler - The handler function
     */
    protected registerHandler(type: string, handler: MessageHandler): void;
}
export {};
//# sourceMappingURL=ConnectionBase.d.ts.map
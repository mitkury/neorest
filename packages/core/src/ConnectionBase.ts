import { CommunicationStrategy } from './CommunicationStrategy';
import { 
  MsgID, 
  MsgType, 
  MsgWrapper, 
  Payload, 
  RouteResponse, 
  MsgDataSet, 
  DATA_SET, 
  PING, 
  RESPONSE, 
  MsgResponse,
  new_MsgResponseOK,
  new_MsgGenericError,
  new_RouteResponse,
  new_RouteResponseError,
  new_MsgWrapper,
  new_SendAndForgetMsgWrapper
} from './types';
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
export abstract class ConnectionBase {
  // Configuration
  protected static RESEND_NOT_ANSWERED_MESSAGES_AFTER_MS = 3000;
  protected static SEND_LIMIT_PER_SEC = 100;
  
  // State
  protected strategy: CommunicationStrategy;
  protected nextMsgId: MsgID = 0;
  protected messagesToAck: {
    wrappedMsg: MsgWrapper;
    sentAt: number;
    sentAmount: number;
  }[] = [];
  protected receivedMessages: MessageResponsePair[] = [];
  protected messagesToSendAfterReconnect: MsgWrapper[] = [];
  protected callbacks: Map<MsgID, (response: RouteResponse<any>) => void> = new Map();
  protected messagesSentInASecond = 0;
  protected headers: Record<string, Payload> = {};
  protected messageHandlers: MessageHandlerMap = {};
  protected closingTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Event handlers
  public onOpen: () => void = () => {};
  public onClose: () => void = () => {};
  public onDataSet: (data: [string, Payload]) => void = () => {};

  /**
   * Constructor
   * @param strategy - The communication strategy to use
   */
  constructor(strategy: CommunicationStrategy) {
    this.strategy = strategy;
    this.setupStrategyHandlers();
    this.setupRateLimiting();
    this.registerDefaultHandlers();
  }

  /**
   * Connect to the server
   */
  public async connect(): Promise<void> {
    await this.strategy.connect();
    this.onOpen();
  }

  /**
   * Close the connection
   */
  public close(): void {
    this.clearClosingTimer();
    this.strategy.disconnect();
  }

  /**
   * Set a new communication strategy
   * @param newStrategy - The new strategy to use
   */
  public async setStrategy(newStrategy: CommunicationStrategy): Promise<void> {
    this.close();
    this.strategy = newStrategy;
    this.setupStrategyHandlers();
    await this.connect();
    this.sendMessagesFromLaterList();
  }

  /**
   * Post a message and register a callback for the response
   * @param msg - The message to post
   * @param callback - The callback to register
   */
  public post(msg: MsgType, callback?: (response: RouteResponse<any>) => void): void {
    const msgId = this.postAndExpectResponse(msg);
    if (callback) {
      this.callbacks.set(msgId, callback);
    }
  }

  /**
   * Get a header value
   * @param key - The header key
   * @returns The header value
   */
  public getHeader(key: string): Payload | undefined {
    return this.headers[key];
  }

  /**
   * Set a header value
   * @param key - The header key
   * @param value - The header value
   */
  public setHeader(key: string, value: Payload): void {
    this.headers[key] = value;
  }

  /**
   * Set up rate limiting
   */
  private setupRateLimiting(): void {
    setInterval(() => {
      this.messagesSentInASecond = 0;
    }, 1000);
  }

  /**
   * Set up event handlers for the strategy
   */
  private setupStrategyHandlers(): void {
    this.strategy.onMessage(this.handleSocketEvent.bind(this));
    
    this.strategy.onClose(() => {
      this.clearClosingTimer();
      this.onClose();
    });

    this.strategy.onOpen(() => {
      this.clearClosingTimer();
      this.onOpen();
    });
  }

  /**
   * Register default message handlers
   */
  protected registerDefaultHandlers(): void {
    // Register handler for DATA_SET messages
    this.messageHandlers[DATA_SET] = (id: MsgID, msg: MsgType): MsgResponse => {
      const dataSetMsg = msg as MsgDataSet;
      this.headers[dataSetMsg.key] = dataSetMsg.value;
      this.onDataSet([dataSetMsg.key, dataSetMsg.value]);
      return new_MsgResponseOK(id, [dataSetMsg.key, dataSetMsg.value]);
    };

    // Register handler for PING messages
    this.messageHandlers[PING] = (id: MsgID): MsgResponse => {
      return new_MsgResponseOK(id, "pong");
    };
  }

  /**
   * Handle a socket event
   * @param wrapper - The message wrapper
   */
  private handleSocketEvent(wrapper: MsgWrapper): void {
    this.handleMessage(wrapper);
  }

  /**
   * Handle a message
   * @param wrapper - The message wrapper
   */
  protected handleMessage(wrapper: MsgWrapper): void {
    const id = wrapper.id;
    // When id is -1 it means that the message doesn't expect a response.
    // And we won't save it in the list of received messages.
    const needsResponse = id !== -1;
    const msg = wrapper.msg;

    const alreadyReceived = needsResponse ? this.getReceivedPairById(id) : null;
    if (alreadyReceived) {
      if (alreadyReceived.response.isPending) {
        console.log("Message is being processed");
        this.postAndForget(new_MsgGenericError(id, "Message is being processed"));
      } else {
        this.postAndForget(alreadyReceived.response.getOriginal());
      }

      // No need for further handling of that message. We already did that before.
      return;
    }

    let response: MsgResponse | Promise<MsgResponse> | null = null;

    try {
      if (msg.type === RESPONSE) {
        this.handleResponse(msg as MsgResponse);
      } else {
        // Look up handler for this message type
        const handler = this.messageHandlers[msg.type];
        
        if (handler) {
          const handlerResponse = handler(id, msg);
          if (handlerResponse !== null) {
            response = handlerResponse;
          }
        } else {
          console.error(`No handler for message type: ${msg.type}`);
          response = new_MsgGenericError(id, `Unknown message type: ${msg.type}`);
        }
      }

      if (needsResponse) {
        if (!response) {
          response = new_MsgGenericError(id, "No response");
        }

        this.postAndForget(response);
      }
    } catch (e) {
      if (needsResponse) {
        console.error("Error handling message", e);
        this.postAndForget(new_MsgGenericError(id, "Error handling message"));
      }
    }

    if (needsResponse) {
      if (response === null) {
        response = new_MsgGenericError(id, "No response");
      }

      this.receivedMessages.push({ wrapper, response: new TrackedPromise(response) });
    }
  }

  /**
   * Get a received message pair by ID
   * @param id - The message ID
   * @returns The message pair, or null if not found
   */
  private getReceivedPairById(id: MsgID): MessageResponsePair | null {
    for (let i = this.receivedMessages.length - 1; i >= 0; i--) {
      if (this.receivedMessages[i].wrapper.id === id) {
        return this.receivedMessages[i];
      }
    }

    return null;
  }

  /**
   * Handle a response message
   * @param msg - The response message
   */
  private handleResponse(msg: MsgResponse): void {
    const msgId = msg.target;

    if (msg.status === 202) {
      // When the message we sent is being processed we don't need to do anything.
      return;
    }

    let response: RouteResponse;

    if (msg.status === 200) {
      response = new_RouteResponse(msg.data);
    } else {
      response = new_RouteResponseError(msg.data as string);
    }

    const callback = this.callbacks.get(msgId);
    if (callback) {
      callback(response);
      this.callbacks.delete(msgId);
    }

    this.removeMessageToAck(msgId);
  }

  /**
   * Send a message and expect a response
   * @param msg - The message to send
   * @returns The message ID
   */
  protected postAndExpectResponse(msg: MsgType): MsgID {
    if (msg.type === RESPONSE) {
      // We should never expect a response (ack) to a response message.
      // That would result in an infinite loop of responses.
      // Let's throw an error to make sure we don't call it by mistake.
      throw new Error("Can't send a response that expects an acknowledge");
    }

    const id = this.nextMsgId++;
    const wrappedMsg = new_MsgWrapper(id, msg);

    if (this.strategy.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error("Error sending message", e);
      }
    } else {
      this.messagesToSendAfterReconnect.push(wrappedMsg);
    }

    return id;
  }

  /**
   * Send a message and forget about the response
   * @param msgOrPromise - The message to send, or a promise that resolves to a message
   */
  protected async postAndForget(msgOrPromise: MsgType | Promise<MsgType>): Promise<void> {
    const msg = await msgOrPromise;

    const wrappedMsg = new_SendAndForgetMsgWrapper(msg);

    // We drop 'post and forget' messages if the socket is not open.
    if (this.strategy.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error("Error sending message", e);
      }
    }
  }

  /**
   * Check if a message needs an acknowledgment
   * @param wrappedMsg - The message wrapper
   * @returns True if the message needs an acknowledgment, false otherwise
   */
  private static messageNeedsAck(wrappedMsg: MsgWrapper): boolean {
    return wrappedMsg.id !== -1 && wrappedMsg.msg.type !== RESPONSE;
  }

  /**
   * Send a wrapped message
   * @param wrappedMsg - The message wrapper
   * @param sentIdx - The index in the messagesToAck array, or -1 if not in the array
   */
  protected sendWrappedMsg(wrappedMsg: MsgWrapper, sentIdx = -1): void {
    if (ConnectionBase.messageNeedsAck(wrappedMsg)) {
      let targetIndex = sentIdx;
      if (sentIdx === -1) {
        // Add or update the message in the list of messages to acknowledge. 
        // Those messages expect to get a response.
        for (let i = this.messagesToAck.length - 1; i >= 0; i--) {
          if (this.messagesToAck[i].wrappedMsg.id === wrappedMsg.id) {
            targetIndex = i;
            break;
          }
        }
      }

      if (targetIndex === -1) {
        this.messagesToAck.push({
          wrappedMsg,
          sentAt: Date.now(),
          sentAmount: 1
        });
      } else {
        this.messagesToAck[targetIndex].sentAmount++;
        this.messagesToAck[targetIndex].sentAt = Date.now();
      }
    }

    this.strategy.send(wrappedMsg);
  }

  /**
   * Remove a message from the messagesToAck array
   * @param id - The message ID
   */
  private removeMessageToAck(id: MsgID): void {
    for (let i = this.messagesToAck.length - 1; i >= 0; i--) {
      if (this.messagesToAck[i].wrappedMsg.id === id) {
        this.messagesToAck.splice(i, 1);
        return;
      }
    }
  }

  /**
   * Send messages that were queued while disconnected
   */
  protected sendMessagesFromLaterList(): void {
    for (const msg of this.messagesToSendAfterReconnect) {
      this.sendWrappedMsg(msg);
    }

    this.messagesToSendAfterReconnect = [];
  }

  /**
   * Clear the closing timer
   */
  protected clearClosingTimer(): void {
    if (this.closingTimer) {
      clearTimeout(this.closingTimer);
      this.closingTimer = null;
    }
  }

  /**
   * Register a handler for a message type
   * @param type - The message type
   * @param handler - The handler function
   */
  protected registerHandler(type: string, handler: MessageHandler): void {
    this.messageHandlers[type] = handler;
  }
}
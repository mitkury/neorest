import { CommunicationTransport } from './CommunicationTransport';
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
  new_MsgWrapper,
  new_SendAndForgetMsgWrapper,
} from './types';
import { TrackedPromise } from './utils/TrackedPromise';

interface MessageResponsePair {
  wrapper: MsgWrapper;
  response: TrackedPromise<MsgResponse>;
}

type MessageHandler = (id: MsgID, msg: MsgType) => Promise<MsgResponse> | MsgResponse | null;

interface MessageHandlerMap {
  [key: string]: MessageHandler;
}

export abstract class ConnectionBase {
  protected static SEND_LIMIT_PER_SEC = 100;
  private static RECEIVED_MESSAGE_HISTORY_LIMIT = 1000;

  protected transport: CommunicationTransport;
  protected nextMsgId: MsgID = 0;
  protected messagesToAck: {
    wrappedMsg: MsgWrapper;
    sentAt: number;
    sentAmount: number;
  }[] = [];
  protected receivedMessages: MessageResponsePair[] = [];
  protected messagesToSendAfterReconnect: MsgWrapper[] = [];
  protected callbacks: Map<MsgID, (response: RouteResponse<any>) => void> = new Map();
  private callbackTimers: Map<MsgID, ReturnType<typeof setTimeout>> = new Map();
  protected messagesSentInASecond = 0;
  protected headers: Record<string, Payload> = {};
  protected messageHandlers: MessageHandlerMap = {};
  protected rateLimitInterval: ReturnType<typeof setInterval> | null = null;

  public onOpen: () => void = () => {};
  public onClose: () => void = () => {};
  public onDataSet: (data: [string, Payload]) => void = () => {};

  constructor(transport: CommunicationTransport) {
    this.transport = transport;
    this.setupTransportHandlers();
    this.setupRateLimiting();
    this.registerDefaultHandlers();
  }

  public async connect(): Promise<void> {
    if (!this.rateLimitInterval) {
      this.setupRateLimiting();
    }
    await this.transport.connect();
  }

  public close(): void {
    this.clearRateLimitInterval();
    this.completePendingCallbacks({
      error: 'Connection closed',
      data: '',
      status: 503,
    });
    this.messagesToAck = [];
    this.messagesToSendAfterReconnect = [];
    this.disconnectTransport();
  }

  public async setTransport(newTransport: CommunicationTransport): Promise<void> {
    const previousTransport = this.transport;
    this.transport = newTransport;
    this.setupTransportHandlers();
    previousTransport.disconnect();
    await this.connect();
    this.sendMessagesFromLaterList();
  }

  public post(
    msg: MsgType,
    callback?: (response: RouteResponse<any>) => void,
    timeoutMs?: number,
  ): void {
    this.postAndExpectResponse(msg, callback, timeoutMs);
  }

  public getHeader(key: string): Payload | undefined {
    return this.headers[key];
  }

  public setHeader(key: string, value: Payload): void {
    this.headers[key] = value;
  }

  private setupRateLimiting(): void {
    this.rateLimitInterval = setInterval(() => {
      this.messagesSentInASecond = 0;
    }, 1000);
  }

  private setupTransportHandlers(): void {
    const targetTransport = this.transport;
    targetTransport.onMessage((wrapper) => {
      if (this.transport === targetTransport) {
        this.handleSocketEvent(wrapper);
      }
    });

    targetTransport.onClose(() => {
      if (this.transport !== targetTransport) {
        return;
      }
      this.onClose();
    });

    targetTransport.onOpen(() => {
      if (this.transport !== targetTransport) {
        return;
      }
      this.onOpen();
    });
  }

  protected registerDefaultHandlers(): void {
    this.messageHandlers[DATA_SET] = (id: MsgID, msg: MsgType): MsgResponse => {
      const dataSetMsg = msg as MsgDataSet;
      this.headers[dataSetMsg.key] = dataSetMsg.value;
      this.onDataSet([dataSetMsg.key, dataSetMsg.value]);
      return new_MsgResponseOK(id, [dataSetMsg.key, dataSetMsg.value]);
    };

    this.messageHandlers[PING] = (id: MsgID): MsgResponse => {
      return new_MsgResponseOK(id, 'pong');
    };
  }

  private handleSocketEvent(wrapper: MsgWrapper): void {
    this.handleMessage(wrapper);
  }

  protected handleMessage(wrapper: MsgWrapper): void {
    if (
      !wrapper
      || !Number.isInteger(wrapper.id)
      || !wrapper.msg
      || typeof wrapper.msg.type !== 'string'
    ) {
      console.error('Ignoring invalid message wrapper');
      return;
    }

    const id = wrapper.id;
    const needsResponse = id !== -1;
    const msg = wrapper.msg;

    const alreadyReceived = needsResponse ? this.getReceivedPairById(id) : null;
    if (alreadyReceived) {
      void this.postAndForget(alreadyReceived.response.getOriginal());
      return;
    }

    if (msg.type === RESPONSE) {
      this.handleResponse(msg as MsgResponse);
      return;
    }

    const response = Promise.resolve()
      .then(async () => {
        const handler = this.messageHandlers[msg.type];
        if (!handler) {
          console.error(`No handler for message type: ${msg.type}`);
          return new_MsgGenericError(id, `Unknown message type: ${msg.type}`);
        }

        const handlerResponse = await handler(id, msg);
        return handlerResponse || new_MsgGenericError(id, 'No response');
      })
      .catch((error) => {
        console.error('Error handling message', error);
        return new_MsgGenericError(id, 'Error handling message');
      });

    if (!needsResponse) {
      void response;
      return;
    }

    this.receivedMessages.push({
      wrapper,
      response: new TrackedPromise(response),
    });
    if (this.receivedMessages.length > ConnectionBase.RECEIVED_MESSAGE_HISTORY_LIMIT) {
      this.receivedMessages.splice(
        0,
        this.receivedMessages.length - ConnectionBase.RECEIVED_MESSAGE_HISTORY_LIMIT,
      );
    }

    void this.postAndForget(response).catch((error) => {
      console.error('Error sending message response', error);
    });
  }

  protected registerResponseCallback(
    id: MsgID,
    callback: (response: RouteResponse<any>) => void,
    timeoutMs?: number,
  ): void {
    if (
      timeoutMs !== undefined
      && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    ) {
      throw new Error('Request timeout must be a positive number');
    }

    this.callbacks.set(id, callback);
    if (timeoutMs === undefined) {
      return;
    }

    const timer = setTimeout(() => {
      if (!this.callbacks.delete(id)) {
        return;
      }
      this.callbackTimers.delete(id);
      this.removePendingMessage(id);
      try {
        callback({
          error: `Request timed out after ${timeoutMs}ms`,
          data: '',
          status: 408,
        });
      } catch (error) {
        console.error('Error in response callback', error);
      }
    }, timeoutMs);
    this.callbackTimers.set(id, timer);
  }

  private getReceivedPairById(id: MsgID): MessageResponsePair | null {
    for (let i = this.receivedMessages.length - 1; i >= 0; i--) {
      if (this.receivedMessages[i].wrapper.id === id) {
        return this.receivedMessages[i];
      }
    }

    return null;
  }

  private handleResponse(msg: MsgResponse): void {
    const msgId = msg.target;

    if (msg.status === 202) {
      return;
    }

    let response: RouteResponse;

    if (msg.status >= 200 && msg.status < 300) {
      response = { data: msg.data, status: msg.status } as RouteResponse;
    } else {
      response = { error: msg.data as string, data: '', status: msg.status } as RouteResponse;
    }

    const callback = this.callbacks.get(msgId);
    if (callback) {
      this.callbacks.delete(msgId);
      this.clearCallbackTimer(msgId);
      try {
        callback(response);
      } catch (error) {
        console.error('Error in response callback', error);
      }
    }

    this.removePendingMessage(msgId);
  }

  public postAndExpectResponse(
    msg: MsgType,
    callback?: (response: RouteResponse<any>) => void,
    timeoutMs?: number,
  ): MsgID {
    if (msg.type === RESPONSE) {
      throw new Error("Can't send a response that expects an acknowledge");
    }

    const id = this.nextMsgId++;
    const wrappedMsg = new_MsgWrapper(id, msg);
    if (callback) {
      this.registerResponseCallback(id, callback, timeoutMs);
    }

    if (this.transport.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error('Error sending message', e);
        this.completeCallback(id, {
          error: 'Failed to send message',
          data: '',
          status: 503,
        });
      }
    } else {
      this.messagesToSendAfterReconnect.push(wrappedMsg);
    }

    return id;
  }

  protected async postAndForget(msgOrPromise: MsgType | Promise<MsgType>): Promise<void> {
    const msg = await msgOrPromise;
    const wrappedMsg = new_SendAndForgetMsgWrapper(msg);

    if (this.transport.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error('Error sending message', e);
      }
    }
  }

  private static messageNeedsAck(wrappedMsg: MsgWrapper): boolean {
    return wrappedMsg.id !== -1 && wrappedMsg.msg.type !== RESPONSE;
  }

  protected sendWrappedMsg(wrappedMsg: MsgWrapper, sentIdx = -1): void {
    if (ConnectionBase.messageNeedsAck(wrappedMsg)) {
      let targetIndex = sentIdx;
      if (sentIdx === -1) {
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
          sentAmount: 1,
        });
      } else {
        this.messagesToAck[targetIndex].sentAmount++;
        this.messagesToAck[targetIndex].sentAt = Date.now();
      }
    }

    this.transport.send(wrappedMsg);
  }

  private removeMessageToAck(id: MsgID): void {
    for (let i = this.messagesToAck.length - 1; i >= 0; i--) {
      if (this.messagesToAck[i].wrappedMsg.id === id) {
        this.messagesToAck.splice(i, 1);
        return;
      }
    }
  }

  private removePendingMessage(id: MsgID): void {
    this.removeMessageToAck(id);
    this.messagesToSendAfterReconnect = this.messagesToSendAfterReconnect.filter(
      (message) => message.id !== id,
    );
  }

  private clearCallbackTimer(id: MsgID): void {
    const timer = this.callbackTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.callbackTimers.delete(id);
    }
  }

  private completeCallback(id: MsgID, response: RouteResponse<any>): void {
    const callback = this.callbacks.get(id);
    if (!callback) {
      return;
    }
    this.callbacks.delete(id);
    this.clearCallbackTimer(id);
    this.removePendingMessage(id);
    try {
      callback(response);
    } catch (error) {
      console.error('Error in response callback', error);
    }
  }

  private completePendingCallbacks(response: RouteResponse<any>): void {
    for (const id of [...this.callbacks.keys()]) {
      this.completeCallback(id, response);
    }
  }

  protected sendMessagesFromLaterList(): void {
    for (const msg of this.messagesToSendAfterReconnect) {
      this.sendWrappedMsg(msg);
    }

    this.messagesToSendAfterReconnect = [];
  }

  protected disconnectTransport(): void {
    this.transport.disconnect();
  }

  protected clearRateLimitInterval(): void {
    if (this.rateLimitInterval) {
      clearInterval(this.rateLimitInterval);
      this.rateLimitInterval = null;
    }
  }

  protected registerHandler(type: string, handler: MessageHandler): void {
    this.messageHandlers[type] = handler;
  }
}

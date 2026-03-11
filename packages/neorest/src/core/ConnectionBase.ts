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
  protected messagesSentInASecond = 0;
  protected headers: Record<string, Payload> = {};
  protected messageHandlers: MessageHandlerMap = {};
  protected closingTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.disconnectTransport();
  }

  public async setTransport(newTransport: CommunicationTransport): Promise<void> {
    this.disconnectTransport();
    this.transport = newTransport;
    this.setupTransportHandlers();
    await this.connect();
    this.sendMessagesFromLaterList();
  }

  public post(msg: MsgType, callback?: (response: RouteResponse<any>) => void): void {
    const msgId = this.postAndExpectResponse(msg);
    if (callback) {
      this.callbacks.set(msgId, callback);
    }
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
    this.transport.onMessage(this.handleSocketEvent.bind(this));

    this.transport.onClose(() => {
      this.clearClosingTimer();
      this.onClose();
    });

    this.transport.onOpen(() => {
      this.clearClosingTimer();
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
    const id = wrapper.id;
    const needsResponse = id !== -1;
    const msg = wrapper.msg;

    const alreadyReceived = needsResponse ? this.getReceivedPairById(id) : null;
    if (alreadyReceived) {
      if (alreadyReceived.response.isPending) {
        this.postAndForget(new_MsgGenericError(id, 'Message is being processed'));
      } else {
        this.postAndForget(alreadyReceived.response.getOriginal());
      }
      return;
    }

    let response: MsgResponse | Promise<MsgResponse> | null = null;

    try {
      if (msg.type === RESPONSE) {
        this.handleResponse(msg as MsgResponse);
      } else {
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
          response = new_MsgGenericError(id, 'No response');
        }

        this.postAndForget(response);
      }
    } catch (e) {
      if (needsResponse) {
        console.error('Error handling message', e);
        this.postAndForget(new_MsgGenericError(id, 'Error handling message'));
      }
    }

    if (needsResponse) {
      if (response === null) {
        response = new_MsgGenericError(id, 'No response');
      }

      this.receivedMessages.push({ wrapper, response: new TrackedPromise(response) });
    }
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
      callback(response);
      this.callbacks.delete(msgId);
    }

    this.removeMessageToAck(msgId);
  }

  public postAndExpectResponse(msg: MsgType): MsgID {
    if (msg.type === RESPONSE) {
      throw new Error("Can't send a response that expects an acknowledge");
    }

    const id = this.nextMsgId++;
    const wrappedMsg = new_MsgWrapper(id, msg);

    if (this.transport.isConnected()) {
      try {
        this.sendWrappedMsg(wrappedMsg);
      } catch (e) {
        console.error('Error sending message', e);
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

  protected sendMessagesFromLaterList(): void {
    for (const msg of this.messagesToSendAfterReconnect) {
      this.sendWrappedMsg(msg);
    }

    this.messagesToSendAfterReconnect = [];
  }

  protected clearClosingTimer(): void {
    if (this.closingTimer) {
      clearTimeout(this.closingTimer);
      this.closingTimer = null;
    }
  }

  protected disconnectTransport(): void {
    this.clearClosingTimer();
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

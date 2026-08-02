import { ConnectionBase } from './ConnectionBase';
import { 
  MsgID,
  MsgRoute,
  ROUTE_MESSAGE,
  DATA_SET,
  ON_ROUTE,
  OFF_ROUTE,
  new_MsgResponseOK,
  new_MsgGenericError,
  new_MsgResponseWithCode,
  RouteResponse,
  MsgSubscribeToRoute,
  MsgUnsubscribeFromRoute,
  Payload,
  RouteVerb,
  ConnectionSecret,
  MsgDataSet,
  MsgWrapper,
  ConnectionIdentity,
  SubscriptionAuthorizationResult,
} from './types';
import { CommunicationTransport } from './CommunicationTransport';

/**
 * Server-side connection implementation
 */
export class ServerConnection extends ConnectionBase {
  /**
   * Callback for handling route messages
   */
  public onRouteMessage: (msgId: MsgID, msg: MsgRoute) => Promise<RouteResponse | void> = async () => {};
  
  /**
   * Callback for handling route subscriptions
   */
  public onSubscribeToRoute: (
    route: string,
  ) => Promise<SubscriptionAuthorizationResult> = async () => ({ allowed: true });
  
  /**
   * Callback for handling route unsubscriptions
   */
  public onUnsubscribeFromRoute: (route: string) => void = () => {};

  private readonly identity: Readonly<ConnectionIdentity> | null;
  private readonly maxMessagesPerSecond: number | false;
  private inboundWindowStartedAt = Date.now();
  private inboundMessagesInWindow = 0;
  
  /**
   * Constructor
   * @param transport - The communication transport to use
   * @param onDataSet - Callback for handling data set messages
   */
  constructor(
    transport: CommunicationTransport,
    onDataSet: (data: [string, Payload]) => void = () => {},
    identity: ConnectionIdentity | null = null,
    maxMessagesPerSecond: number | false = 100,
  ) {
    super(transport);
    this.identity = identity
      ? Object.freeze({ ...identity })
      : null;
    this.maxMessagesPerSecond = maxMessagesPerSecond;
    this.onDataSet = onDataSet;
    this.registerRouteHandlers();

    // Lock down secret: ignore/forbid client attempts to set/override 'secret'
    this.registerHandler(DATA_SET, (msgId, msg) => {
      const dataMsg = msg as MsgDataSet;
      const key = dataMsg.key;
      const value = dataMsg.value;

      if (key === 'secret') {
        // Do not allow client to set or change the secret on server
        return new_MsgResponseWithCode(msgId, 403, 'Secret is server-managed');
      }

      // Allow other headers to be set server-side
      this.setHeader(key, value);
      this.onDataSet([key, value]);
      return new_MsgResponseOK(msgId, [key, value]);
    });
  }

  /**
   * Get the connection secret
   * @returns The connection secret
   */
  public getSecret(): ConnectionSecret {
    return this.getHeader('secret') as ConnectionSecret || '';
  }

  /**
   * Return the immutable identity established by the server handshake.
   */
  public getIdentity<T extends ConnectionIdentity = ConnectionIdentity>(): Readonly<T> | null {
    return this.identity as Readonly<T> | null;
  }

  /**
   * Get the current communication transport
   * @returns The current transport
   */
  public getTransport(): CommunicationTransport {
    return this.transport;
  }

  /**
   * Update the communication transport (for reconnection)
   * @param newTransport - The new communication transport
   */
  public async setTransport(newTransport: CommunicationTransport): Promise<void> {
    // Clear deduplication state so that new client-side
    // message IDs (which typically start from 0) are not mistaken for
    // duplicates of the previous transport session.
    this.receivedMessages = [];

    await super.setTransport(newTransport);

    // Secret is already available in the connection URL, no need to send DATA_SET message
  }

  /**
   * Send a message to a route
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   */
  public sendToRoute(route: string, verb: RouteVerb, payload: Payload, headers?: Record<string, string>): void {
    const msg = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload,
      headers
    };
    
    this.postAndForget(msg);
  }

  /**
   * Send a targeted route message that is retained while this logical
   * connection replaces its transport. Used for live-session signaling where
   * dropping an event would leave WebRTC negotiation incomplete.
   */
  public sendToRouteAfterReconnect(
    route: string,
    verb: RouteVerb,
    payload: Payload,
    headers?: Record<string, string>,
  ): void {
    const message: MsgRoute = {
      type: ROUTE_MESSAGE,
      verb,
      route,
      data: payload,
      headers,
    };
    this.postAndForgetAfterReconnect(message);
  }

  /**
   * Register handlers for route-related messages
   */
  private registerRouteHandlers(): void {
    // Handler for route messages
    this.registerHandler(ROUTE_MESSAGE, async (msgId, msg) => {
      const routeMsg = msg as MsgRoute;
      const response = await this.onRouteMessage(msgId, routeMsg);
      
      if (!response) {
        return new_MsgResponseOK(msgId);
      } else {
        if (!response.error) {
          const status = (response as any).status || 200;
          if (status === 200) {
            return new_MsgResponseOK(msgId, response.data);
          }
          return new_MsgResponseWithCode(msgId, status, response.data as any as string);
        } else {
          const status = (response as any).status || 500;
          if (status === 500) {
            return new_MsgGenericError(msgId, response.error);
          }
          return new_MsgResponseWithCode(msgId, status, response.error);
        }
      }
    });
    
    // Handler for subscription messages
    this.registerHandler(ON_ROUTE, async (msgId, msg) => {
      const subMsg = msg as MsgSubscribeToRoute;
      const authorization = await this.onSubscribeToRoute(subMsg.route);
      if (!authorization.allowed) {
        return new_MsgResponseWithCode(
          msgId,
          authorization.status || 403,
          authorization.error || 'Subscription forbidden',
        );
      }
      return new_MsgResponseOK(msgId);
    });
    
    // Handler for unsubscription messages
    this.registerHandler(OFF_ROUTE, (msgId, msg) => {
      const unsubMsg = msg as MsgUnsubscribeFromRoute;
      this.onUnsubscribeFromRoute(unsubMsg.route);
      return new_MsgResponseOK(msgId);
    });
  }

  protected handleMessage(wrapper: MsgWrapper): void {
    if (this.maxMessagesPerSecond !== false) {
      const now = Date.now();
      if (now - this.inboundWindowStartedAt >= 1000) {
        this.inboundWindowStartedAt = now;
        this.inboundMessagesInWindow = 0;
      }
      if (this.inboundMessagesInWindow >= this.maxMessagesPerSecond) {
        if (wrapper.id !== -1) {
          void this.postAndForget(
            new_MsgResponseWithCode(wrapper.id, 429, 'Server message rate limit exceeded'),
          );
        }
        return;
      }
      this.inboundMessagesInWindow++;
    }
    super.handleMessage(wrapper);
  }

}

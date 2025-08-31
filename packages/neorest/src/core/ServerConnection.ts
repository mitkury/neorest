import { ConnectionBase } from './ConnectionBase';
import { 
  ServerStrategy, 
  CommunicationStrategy,
  MsgID,
  MsgRoute,
  ROUTE_MESSAGE,
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
  ConnectionSecret
} from './types';

/**
 * Server-side connection implementation
 */
export class ServerConnection extends ConnectionBase {
  private static CLOSE_ON_SERVER_AFTER_MS = 5000;
  
  /**
   * Callback for handling route messages
   */
  public onRouteMessage: (msgId: MsgID, msg: MsgRoute) => Promise<RouteResponse | void> = async () => {};
  
  /**
   * Callback for handling route subscriptions
   */
  public onSubscribeToRoute: (route: string) => void = () => {};
  
  /**
   * Callback for handling route unsubscriptions
   */
  public onUnsubscribeFromRoute: (route: string) => void = () => {};
  
  /**
   * Constructor
   * @param strategy - The communication strategy to use
   * @param onDataSet - Callback for handling data set messages
   */
  constructor(
    strategy: CommunicationStrategy, 
    onDataSet: (data: [string, Payload]) => void = () => {}
  ) {
    super(strategy);
    this.onDataSet = onDataSet;
    this.registerRouteHandlers();
    this.setupServerCloseTimeout();
  }

  /**
   * Get the connection secret
   * @returns The connection secret
   */
  public getSecret(): ConnectionSecret {
    return this.getHeader('secret') as ConnectionSecret || '';
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
    this.registerHandler(ON_ROUTE, (msgId, msg) => {
      const subMsg = msg as MsgSubscribeToRoute;
      this.onSubscribeToRoute(subMsg.route);
      return new_MsgResponseOK(msgId);
    });
    
    // Handler for unsubscription messages
    this.registerHandler(OFF_ROUTE, (msgId, msg) => {
      const unsubMsg = msg as MsgUnsubscribeFromRoute;
      this.onUnsubscribeFromRoute(unsubMsg.route);
      return new_MsgResponseOK(msgId);
    });
  }

  /**
   * Set up server-side close timeout
   */
  private setupServerCloseTimeout(): void {
    const originalOnClose = this.onClose;
    this.onClose = () => {
      this.clearClosingTimer();
      this.closingTimer = setTimeout(() => {
        originalOnClose();
      }, ServerConnection.CLOSE_ON_SERVER_AFTER_MS);
    };
  }
}
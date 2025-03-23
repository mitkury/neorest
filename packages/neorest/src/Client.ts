import { 
  RouteResponse, 
  Payload, 
  RouteVerb,
  BroadcastEvent,
  ConnectionOptions
} from '../../core/src/index.ts';
import { ClientConnection } from './ClientConnection.ts';
import { createStrategy } from './strategies/index.ts';

/**
 * Neorest client for connecting to a server
 */
export class Client {
  private conn: ClientConnection;
  
  /**
   * Constructor
   * @param url - The URL to connect to
   * @param strategyType - The type of strategy to use
   * @param options - Options for the connection
   */
  constructor(url: string, strategyType: 'websocket' | 'http' = 'websocket', options?: ConnectionOptions) {
    if (!url) {
      throw new Error("URL is required to create a client connection");
    }
    
    const strategy = createStrategy(strategyType, url);
    this.conn = new ClientConnection(strategy, options);
  }

  /**
   * Get the URL of the connection
   * @returns The URL
   */
  public getURL(): string | undefined {
    return this.conn.getHeader('url') as string | undefined;
  }

  /**
   * Check if the client is connected
   * @returns True if connected, false otherwise
   */
  public isConnected(): boolean {
    return this.conn.isConnected();
  }

  /**
   * Set the URL of the connection
   * @param url - The URL to connect to
   * @param strategyType - The type of strategy to use
   * @returns A promise that resolves when the connection is established
   */
  public async setUrl(url: string, strategyType?: 'websocket' | 'http'): Promise<void> {
    return this.conn.setUrl(url, strategyType);
  }

  /**
   * Close the connection
   */
  public close(): void {
    this.conn.close();
  }

  /**
   * Send a GET request to a route
   * @param route - The route to send to
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  public get<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return this.sendToRoute<T>(route, "GET", "", headers);
  }

  /**
   * Send a DELETE request to a route
   * @param route - The route to send to
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  public delete<T = any>(route: string, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return this.sendToRoute<T>(route, "DELETE", "", headers);
  }

  /**
   * Send a POST request to a route
   * @param route - The route to send to
   * @param payload - The payload to send
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  public post<T = any>(route: string, payload?: Payload, headers?: Record<string, string>): Promise<RouteResponse<T>> {
    return this.sendToRoute<T>(route, "POST", payload, headers);
  }

  /**
   * Send a POST request to a route without expecting a response
   * @param route - The route to send to
   * @param payload - The payload to send
   * @param headers - Optional headers
   */
  public postAndForget(route: string, payload?: Payload, headers?: Record<string, string>): void {
    this.conn.sendToRouteAndForget(route, "POST", payload !== undefined ? payload : "", headers);
  }

  /**
   * Send a request to a route
   * @param route - The route to send to
   * @param verb - The HTTP verb to use
   * @param payload - The payload to send
   * @param headers - Optional headers
   * @returns A promise that resolves with the response
   */
  private sendToRoute<T = any>(
    route: string,
    verb: RouteVerb,
    payload?: Payload,
    headers?: Record<string, string>,
  ): Promise<RouteResponse<T>> {
    // Here we return a promise that resolves when the server responds.
    // When the server responds, the callback is called from Connection's `handleResponse` method.
    return new Promise((resolve) => {
      this.conn.sendToRoute(route, verb, payload !== undefined ? payload : "", headers, (response: RouteResponse<T>) => {
        resolve(response);
      });
    });
  }

  /**
   * Subscribe to a route
   * @param route - The route to subscribe to
   * @param callback - The callback to call when a message is received on the route
   * @returns A promise that resolves when the subscription is established
   */
  public on<T = any>(
    route: string,
    callback: (broadcast: BroadcastEvent<T>) => void,
  ): Promise<void> {
    return this.conn.subscribeToRoute<T>(route, callback);
  }

  /**
   * Unsubscribe from a route
   * @param route - The route to unsubscribe from
   */
  public off(route: string): void {
    this.conn.unsubscribeFromRoute(route);
  }
}
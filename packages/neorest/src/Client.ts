import { 
  RouteResponse, 
  Payload, 
  RouteVerb,
  BroadcastEvent,
  ConnectionOptions,
  TransportMode,
  newConnectionSecret
} from './core';
import { ClientConnection } from './ClientConnection';
import { createTransport } from './transports/index';
import { LiveClient, type LiveOptions, type LiveSession } from './LiveClient';

/**
 * Neorest client for connecting to a server
 */
export class Client {
  private conn: ClientConnection;
  private readonly liveClient: LiveClient;
  
  /**
   * Constructor
   * @param url - The URL to connect to
   * @param transportType - The type of transport to use
   * @param options - Options for the connection
   */
  constructor(url: string, transportType: TransportMode = 'auto', options?: ConnectionOptions) {
    if (!url) {
      throw new Error("URL is required to create a client connection");
    }
    
    // Check if URL already has a secret parameter
    const urlObj = new URL(url);
    const existingSecret = urlObj.searchParams.get('secret');
    
    let connectionUrl = url;
    if (
      !existingSecret
      && (
        transportType === 'websocket'
        || (transportType === 'auto' && url.startsWith('ws'))
      )
    ) {
      // Generate a secret for this connection only if none exists
      const secret = newConnectionSecret();
      urlObj.searchParams.set('secret', secret);
      connectionUrl = urlObj.toString();
    }
    
    const transport = createTransport(transportType, connectionUrl, options);
    this.conn = new ClientConnection(transport, options);
    this.liveClient = new LiveClient(this.conn);
  }

  /**
   * Get the URL of the connection
   * @returns The URL
   */
  public getURL(): string | undefined {
    return this.conn.getURL();
  }

  /**
   * Check if the client is connected
   * @returns True if connected, false otherwise
   */
  public isConnected(): boolean {
    return this.conn.isConnected();
  }

  /**
   * Observe connection changes. Returns a function that removes the listener.
   */
  public onConnectionChange(callback: (connected: boolean) => void): () => void {
    return this.conn.onConnectionChange(callback);
  }

  /**
   * Establish the underlying transport connection.
   */
  public async connect(): Promise<void> {
    await this.conn.connect();
  }

  /**
   * Set the URL of the connection
   * @param url - The URL to connect to
   * @param transportType - The type of transport to use
   * @returns A promise that resolves when the connection is established
   */
  public async setUrl(url: string, transportType?: TransportMode): Promise<void> {
    await this.liveClient.leaveAll();
    return this.conn.setUrl(url, transportType);
  }

  /**
   * Close the connection
   */
  public close(): void {
    this.liveClient.close();
    this.conn.close();
  }

  /** Open a WebRTC session addressed by a normal Neorest route. */
  public live(route: string, options?: LiveOptions): Promise<LiveSession> {
    return this.liveClient.join(route, options);
  }

  /** Return the active live session for a concrete route, if any. */
  public getLiveSession(route: string): LiveSession | undefined {
    return this.liveClient.get(route);
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
   * Set the Authorization Bearer token to be sent on all requests
   */
  public setAuthToken(token: string): void {
    this.conn.setAuthToken(token);
  }

  /**
   * Clear any default Authorization token
   */
  public clearAuthToken(): void {
    this.conn.clearAuthToken();
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
    return this.conn.on(route, callback);
  }

  /**
   * Subscribe to a route.
   */
  public subscribe<T = any>(
    route: string,
    callback: (broadcast: BroadcastEvent<T>) => void,
  ): Promise<void> {
    return this.on(route, callback);
  }

  /**
   * Unsubscribe from a route
   * @param route - The route to unsubscribe from
   */
  public off(route: string): void {
    this.conn.off(route);
  }

  /**
   * Unsubscribe from a route.
   */
  public unsubscribe(route: string): void {
    this.off(route);
  }
}

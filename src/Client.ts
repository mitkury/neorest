import { Connection } from "./Connection";
import { CommunicationStrategy } from "./communicationStrategies/CommunicationStrategy";
import { WebSocketStrategy } from "./communicationStrategies/WebSocketStrategy";
import { HttpStrategy } from "./communicationStrategies/HttpStrategy";
import {
  new_MsgSubscribeToRoute,
  new_MsgUnsubscribeFromRoute,
  type Payload,
  type RouteResponse,
  type RouteVerb,
} from "./types";

export class Client {
  private conn: Connection;
  private isFullyConnected = false;
  private url?: string;
  private subscribedRoutes: Record<
    string,
    (broadcast: { action: "POST" | "DELETE"; data: Payload }) => void
  > = {};
  private reconnectTimeout: number | ReturnType<typeof setTimeout> = -1;

  constructor(url?: string, strategyType: 'websocket' | 'http' = 'websocket') {
    if (url) {
      this.url = url;
      const strategy = this.createStrategy(strategyType, url);
      this.conn = Connection.newClient(strategy);
    } else {
      throw new Error("URL is required to create a client connection");
    }

    this.setupConnectionHandlers();
  }

  private createStrategy(type: 'websocket' | 'http', url: string): CommunicationStrategy {
    switch (type) {
      case 'websocket':
        return new WebSocketStrategy(url);
      case 'http':
        return new HttpStrategy(url);
      default:
        throw new Error(`Unsupported strategy type: ${type}`);
    }
  }

  private setupConnectionHandlers() {
    this.conn.onRouteMessage = async (_, msg) => {
      const sub = this.subscribedRoutes[msg.route];
      if (sub) {
        const action = msg.verb as "POST" | "DELETE";
        sub({ data: msg.data, action: action });
      }
    };

    this.conn.onClientConnect = () => {
      console.log("Connected to a server");
      this.isFullyConnected = true;
    };

    this.conn.onClose = () => {
      this.isFullyConnected = false;
      clearTimeout(this.reconnectTimeout);
      console.error("Connection closed, re-connecting...");
      this.reconnectTimeout = setTimeout(() => this.reconnect(), 500);
    };
  }

  public getURL() {
    return this.url;
  }

  public isConnected() {
    return this.isFullyConnected;
  }

  private static getUrlWithSecret(url: string, secret: string): string {
    const urlObject = new URL(url);
    urlObject.searchParams.set('secret', secret);
    return urlObject.toString();
  }

  private async reconnect() {
    if (!this.url) {
      return;
    }

    // @TODO: consider making secret part of a strategy. E.g we don't need it for http.
    const secret = this.conn.getSecret();
    const urlWithSecret = Client.getUrlWithSecret(this.url, secret);
    const newStrategy = this.createStrategy(this.conn.getStrategyType(), urlWithSecret);
    await this.conn.setStrategy(newStrategy);
    this.resubscribeToRoutes();
  }

  private resubscribeToRoutes() {
    for (const route in this.subscribedRoutes) {
      this.conn.post(new_MsgSubscribeToRoute(route)).then((response) => {
        if (response.error) {
          console.error(`Failed to resubscribe to route "${route}"`, response.error);
        }
      });
    }
  }

  public async setUrl(url: string, strategyType?: 'websocket' | 'http'): Promise<void> {
    this.url = url;
    const secret = this.conn.getSecret();
    const urlWithSecret = Client.getUrlWithSecret(url, secret);
    const newStrategyType = strategyType || this.conn.getStrategyType();
    const newStrategy = this.createStrategy(newStrategyType, urlWithSecret);
    await this.conn.setStrategy(newStrategy);
    this.resubscribeToRoutes();
  }

  public close() {
    this.conn.close();
  }

  public get(route: string, headers?: Record<string, string>) {
    return this.sendToRoute(route, "GET", "", headers);
  }

  public delete(route: string, headers?: Record<string, string>) {
    return this.sendToRoute(route, "DELETE", "", headers);
  }

  public post(route: string, payload?: Payload, headers?: Record<string, string>): Promise<RouteResponse> {
    return this.sendToRoute(route, "POST", payload, headers);
  }

  public postAndForget(route: string, payload?: Payload, headers?: Record<string, string>) {
    this.conn.sendToRouteAndForget(route, "POST", payload, headers);
  }

  private sendToRoute(
    route: string,
    verb: RouteVerb,
    payload?: Payload,
    headers?: Record<string, string>,
  ): Promise<RouteResponse> {
    // Throw an exception if the route contains invalid characters.
    if (!/^[a-zA-Z0-9_\/-]+$/.test(route)) {
      // Be explicit about colons, because users may send them by accident.
      // The server uses colons for route parameters.
      if (route.includes(":")) {
        throw new Error(`Route "${route}" contains colons ':' which is not allowed. Colons are reserved for route parameters.`);
      }

      throw new Error(`Route "${route}" contains invalid characters. Only alphanumeric characters, forward slashes, dashes and underscores are allowed.`);
    }

    // Here we return a promise that resolves when the server responds.
    // When the server responds, the callback is called from Connection's `handleResponse` method.
    return new Promise((resolve, _) => {
      this.conn.sendToRoute(route, verb, payload, headers, (response: RouteResponse) => {
        resolve(response);
      });
    });
  }

  public on(
    route: string,
    callback: (
      broadcast: { action: "POST" | "DELETE" | "UPDATE"; data: Payload },
    ) => void,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.subscribedRoutes[route]) {
        const errorMsg = `Route "${route}" already has a subscription`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      this.subscribedRoutes[route] = callback;

      // Wait until the connection is fully established before subscribing to a route
      // otherwise the server will reject the subscription.
      while (true) {
        if (this.isFullyConnected) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      this.conn.post(new_MsgSubscribeToRoute(route), (response) => {
        if (response.error) {
          const errorMsg = `Failed to subscribe to route "${route}"`;
          console.error(errorMsg);
          // Remove the subscription if the server rejects it
          delete this.subscribedRoutes[route];
          reject(new Error(errorMsg));
        } else {
          resolve();
        }
      });
    });
  }

  public off(route: string) {
    this.conn.post(new_MsgUnsubscribeFromRoute(route), (response) => {
      if (response.error) {
        console.error(`Failed to unsubscribe from route "${route}"`);
        return;
      }
    });

    delete this.subscribedRoutes[route];
  }
}


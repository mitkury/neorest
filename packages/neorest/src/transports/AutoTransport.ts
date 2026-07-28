import {
  ClientTransport,
  ConnectionInfo,
  ConnectionOptions,
  MsgWrapper,
  TransportUpgradeInfo,
} from '../core';
import { HttpTransport } from './HttpTransport';
import { WebSocketTransport } from './WebSocketTransport';
import { WebTransportTransport } from './WebTransportTransport';

/**
 * Starts on held HTTP, then upgrades in preference order. The HTTP bootstrap
 * remains the universal fallback and supplies an authenticated, single-use
 * ticket to connection-oriented transports.
 */
export class AutoTransport implements ClientTransport {
  private http: HttpTransport;
  private upgraded: ClientTransport | null = null;
  // Kept as a concrete handle for diagnostics and backwards-compatible
  // inspection; routing itself uses the generic `upgraded` transport.
  private ws: WebSocketTransport | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private authData: Record<string, string> = {};
  private connectionSecret: string | null = null;
  private connectionInfo: ConnectionInfo;
  private upgradeTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackPromise: Promise<void> | null = null;
  private isClosing = false;
  private isUpgrading = false;
  private queuedMessages: MsgWrapper[] = [];
  private readonly preference: Array<'webtransport' | 'websocket'>;

  constructor(
    private readonly baseUrl: string,
    private readonly options: ConnectionOptions = {},
  ) {
    this.preference = options.transports
      ? [...new Set(options.transports)]
      : ['webtransport', 'websocket'];
    if (
      this.preference.some(
        (kind) => kind !== 'webtransport' && kind !== 'websocket',
      )
    ) {
      throw new Error('Auto transports must be "webtransport" or "websocket"');
    }
    this.http = this.createHttpTransport();
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url: baseUrl,
      type: 'http',
      status: 'disconnected',
    };
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    this.isClosing = false;
    this.wireHttp(this.http);
    await this.http.connect();
    this.connectionInfo.status = 'connected';
    this.connectionInfo.type = 'http';
    this.waitForSecretAndUpgrade();
  }

  disconnect(): void {
    this.isClosing = true;
    if (this.upgradeTimer) clearTimeout(this.upgradeTimer);
    this.upgradeTimer = null;
    this.upgraded?.disconnect();
    this.upgraded = null;
    this.ws = null;
    this.http.disconnect();
    this.connectionInfo.status = 'disconnected';
  }

  send(message: MsgWrapper): void {
    if (this.isUpgrading || this.fallbackPromise) {
      this.queuedMessages.push(message);
      return;
    }
    if (
      !this.isClosing
      && this.upgraded
      && !this.upgraded.isConnected()
      && !this.http.isConnected()
    ) {
      const closingTransport = this.upgraded;
      this.queuedMessages.push(message);
      this.handleUpgradedClose(closingTransport);
      return;
    }
    if (this.upgraded?.isConnected()) {
      try {
        this.upgraded.send(message);
        return;
      } catch {
        this.queuedMessages.push(message);
        this.handleUpgradedClose(this.upgraded);
        return;
      }
    }
    this.http.send(message);
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
    this.http.onMessage(callback);
    this.upgraded?.onMessage(callback);
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
    if (this.isConnected()) callback();
  }

  isConnected(): boolean {
    return (
      this.upgraded?.isConnected()
      || this.http.isConnected()
      || (
        !this.isClosing
        && (
          this.isUpgrading
          || this.fallbackPromise !== null
          || this.upgraded !== null
        )
      )
    );
  }

  setAuthentication(authData: Record<string, string>): void {
    this.authData = { ...authData };
    this.http.setAuthentication(this.authData);
    this.upgraded?.setAuthentication(this.authData);
  }

  setConnectionSecret(secret: string): void {
    this.connectionSecret = secret;
    this.http.setConnectionSecret(secret);
    const transport = this.upgraded as ClientTransport & {
      setConnectionSecret?: (value: string) => void;
    };
    transport?.setConnectionSecret?.(secret);
  }

  getConnectionInfo(): ConnectionInfo {
    const active = this.upgraded?.isConnected() ? this.upgraded : this.http;
    return {
      ...this.connectionInfo,
      id: active.getConnectionInfo().id,
      type: active.getConnectionInfo().type,
      status: this.isConnected() ? 'connected' : 'disconnected',
    };
  }

  getConnectionMode(): 'auto' {
    return 'auto';
  }

  private async tryUpgrade(): Promise<void> {
    if (this.isClosing || this.upgraded?.isConnected() || this.isUpgrading) return;
    if (this.http.hasPendingSends()) {
      this.upgradeTimer = setTimeout(() => {
        this.upgradeTimer = null;
        void this.tryUpgrade();
      }, 25);
      return;
    }
    const upgradeInfo = this.http.getUpgradeInfo();
    if (!upgradeInfo) return;

    this.isUpgrading = true;
    try {
      for (const kind of this.preference) {
        if (kind === 'webtransport' && !this.canUseWebTransport(upgradeInfo)) continue;
        const candidate = this.createUpgradeTransport(kind, upgradeInfo);
        this.wireUpgrade(candidate);
        try {
          await candidate.connect();
          if (this.isClosing) {
            candidate.disconnect();
            return;
          }
          this.upgraded = candidate;
          this.ws = kind === 'websocket' ? candidate as WebSocketTransport : null;
          this.connectionInfo.type = kind;
          this.http.disconnect();
          this.flushQueue(candidate);
          this.openCallback?.();
          return;
        } catch {
          candidate.disconnect();
        }
      }
      this.flushQueue(this.http);
    } finally {
      this.isUpgrading = false;
    }
  }

  private createUpgradeTransport(
    kind: 'webtransport' | 'websocket',
    info: TransportUpgradeInfo,
  ): ClientTransport {
    if (kind === 'webtransport') {
      const transport = new WebTransportTransport(this.baseUrl, this.options.webTransport);
      transport.setUpgradeInfo(info);
      if (this.connectionSecret) transport.setConnectionSecret(this.connectionSecret);
      if (Object.keys(this.authData).length) transport.setAuthentication(this.authData);
      return transport;
    }

    const url = this.toWebSocketUrl(this.baseUrl);
    if (this.connectionSecret) url.searchParams.set('secret', this.connectionSecret);
    url.searchParams.set('clientId', info.clientId);
    url.searchParams.set('upgradeToken', info.token);
    const transport = new WebSocketTransport(url.toString());
    if (Object.keys(this.authData).length) transport.setAuthentication(this.authData);
    return transport;
  }

  private wireHttp(http: HttpTransport): void {
    if (this.messageCallback) http.onMessage(this.messageCallback);
    http.onOpen(() => {
      this.connectionInfo.type = 'http';
      this.connectionInfo.status = 'connected';
      this.openCallback?.();
    });
    http.onClose(() => {
      if (
        !this.isClosing
        && !this.isUpgrading
        && !this.upgraded?.isConnected()
        && !this.fallbackPromise
      ) {
        this.connectionInfo.status = 'disconnected';
        this.closeCallback?.();
      }
    });
  }

  private wireUpgrade(transport: ClientTransport): void {
    if (this.messageCallback) transport.onMessage(this.messageCallback);
    transport.onClose(() => this.handleUpgradedClose(transport));
  }

  private handleUpgradedClose(transport: ClientTransport): void {
    if (this.isClosing || this.upgraded !== transport) return;
    this.upgraded = null;
    this.ws = null;
    this.connectionInfo.type = 'http';
    void this.restoreHttpFallback().catch((error) => {
      console.error('HTTP fallback failed:', error);
    });
  }

  private restoreHttpFallback(): Promise<void> {
    if (this.fallbackPromise) return this.fallbackPromise;
    this.fallbackPromise = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.isClosing) return;
      const http = this.createHttpTransport();
      this.http = http;
      this.wireHttp(http);
      await http.connect();
      this.connectionInfo.type = 'http';
      this.connectionInfo.status = 'connected';
      this.flushQueue(http);
    })().catch((error) => {
      this.connectionInfo.status = 'disconnected';
      this.closeCallback?.();
      throw error;
    }).finally(() => {
      this.fallbackPromise = null;
    });
    return this.fallbackPromise;
  }

  private createHttpTransport(): HttpTransport {
    const http = new HttpTransport(this.toHttpUrl(this.baseUrl));
    if (this.connectionSecret) http.setConnectionSecret(this.connectionSecret);
    if (Object.keys(this.authData).length) http.setAuthentication(this.authData);
    return http;
  }

  private waitForSecretAndUpgrade(): void {
    const startedAt = Date.now();
    const tick = () => {
      if (this.isClosing) return;
      if (this.connectionSecret) {
        this.upgradeTimer = null;
        void this.tryUpgrade();
      } else if (Date.now() - startedAt <= 2_000) {
        this.upgradeTimer = setTimeout(tick, 50);
      } else {
        this.upgradeTimer = null;
      }
    };
    this.upgradeTimer = setTimeout(tick, 0);
  }

  private canUseWebTransport(info: TransportUpgradeInfo): boolean {
    return Boolean(
      info.webTransportUrl
      && (globalThis as { WebTransport?: unknown }).WebTransport,
    );
  }

  private toHttpUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    return url.toString();
  }

  private toWebSocketUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    return url;
  }

  private flushQueue(transport: ClientTransport): void {
    for (const message of this.queuedMessages.splice(0)) transport.send(message);
  }
}

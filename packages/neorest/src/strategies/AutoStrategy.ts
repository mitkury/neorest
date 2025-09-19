import { ClientStrategy, MsgWrapper, ConnectionInfo } from '../core';
import { WebSocketStrategy } from './WebSocketStrategy';
import { HttpStrategy } from './HttpStrategy';

/**
 * Auto strategy: start with HTTP long-polling, attempt WebSocket upgrade, and fallback to HTTP on failures.
 */
export class AutoStrategy implements ClientStrategy {
  private http: HttpStrategy;
  private ws: WebSocketStrategy | null = null;

  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;

  private authData: Record<string, string> = {};
  private connectionInfo: ConnectionInfo;
  private connectionSecret: string | null = null;

  constructor(private baseUrl: string) {
    this.http = new HttpStrategy(this.ensureHttpUrl(baseUrl));
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url: baseUrl,
      type: 'http',
      status: 'disconnected'
    };
  }

  async connect(): Promise<void> {
    // 1) Connect HTTP first
    await this.http.connect();
    this.connectionInfo.status = 'connected';
    this.connectionInfo.type = 'http';

    // wire callbacks to HTTP
    if (this.messageCallback) this.http.onMessage(this.messageCallback);
    if (this.closeCallback) this.http.onClose(() => this.handleUnderlyingClose('http'));
    if (this.openCallback) this.http.onOpen(() => this.handleUnderlyingOpen('http'));

    // Fire open for HTTP immediately (http strategy already calls its open callback)
    // but ensure the consumer's onOpen is invoked at least once
    if (this.openCallback) this.openCallback();

    // 2) Attempt WS upgrade only after we know the server-issued secret,
    // so that the server can associate the WS transport with the same session.
    this.waitForSecretAndUpgrade();
  }

  disconnect(): void {
    try { this.ws?.disconnect(); } catch {}
    try { this.http.disconnect(); } catch {}
    this.connectionInfo.status = 'disconnected';
  }

  send(message: MsgWrapper): void {
    // Prefer WS if connected; otherwise HTTP
    if (this.ws && this.ws.isConnected()) {
      try {
        this.ws.send(message);
        this.connectionInfo.type = 'websocket';
        return;
      } catch (e) {
        // fallback to HTTP
      }
    }

    // HTTP path
    this.http.send(message);
    this.connectionInfo.type = 'http';
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
    this.http.onMessage(callback);
    if (this.ws) this.ws.onMessage(callback);
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
    this.http.onClose(() => this.handleUnderlyingClose('http'));
    if (this.ws) this.ws.onClose(() => this.handleUnderlyingClose('ws'));
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
    // If underlying are already set, wire them
    this.http.onOpen(() => this.handleUnderlyingOpen('http'));
    if (this.ws) this.ws.onOpen(() => this.handleUnderlyingOpen('ws'));
  }

  isConnected(): boolean {
    return (this.ws?.isConnected?.() ?? false) || this.http.isConnected();
  }

  setAuthentication(authData: Record<string, string>): void {
    this.authData = authData;
    this.http.setAuthentication(authData);
    if (this.ws) this.ws.setAuthentication(authData);
  }

  setConnectionSecret(secret: string): void {
    this.connectionSecret = secret;
    // Also set it on the HTTP strategy if it has the method
    if ((this.http as any).setConnectionSecret) {
      (this.http as any).setConnectionSecret(secret);
    }
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      ...this.connectionInfo,
      url: this.baseUrl,
      status: this.isConnected() ? 'connected' : 'disconnected',
      type: this.ws?.isConnected() ? 'websocket' : 'http',
    };
  }

  // Internals
  private async tryUpgradeToWebSocket(): Promise<void> {
    try {
      let wsUrl = this.ensureWsUrl(this.baseUrl);
      
      // Add connection secret to WebSocket URL if available
      if (this.connectionSecret) {
        const url = new URL(wsUrl);
        url.searchParams.set('secret', this.connectionSecret);
        wsUrl = url.toString();
      }
      
      const ws = new WebSocketStrategy(wsUrl);
      // propagate auth if set
      if (Object.keys(this.authData).length > 0) ws.setAuthentication(this.authData);

      // wire message/open/close to existing callbacks
      if (this.messageCallback) ws.onMessage(this.messageCallback);
      if (this.openCallback) ws.onOpen(() => this.handleUnderlyingOpen('ws'));
      if (this.closeCallback) ws.onClose(() => this.handleUnderlyingClose('ws'));

      await ws.connect();

      // Mark as upgraded
      this.ws = ws;
      this.connectionInfo.type = 'websocket';
      // Trigger consumer open callback again to allow client to send DATA_SET over WS too
      if (this.openCallback) this.openCallback();
    } catch (e) {
      // WS not available or failed; continue on HTTP silently
    }
  }

  private waitForSecretAndUpgrade(): void {
    const start = Date.now();
    const maxWaitMs = 2000;
    const tick = () => {
      if (this.connectionSecret) {
        void this.tryUpgradeToWebSocket();
        return;
      }
      if (Date.now() - start > maxWaitMs) {
        // Give up on waiting; stay on HTTP (will retry later on reconnects if any)
        return;
      }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  private handleUnderlyingOpen(kind: 'http' | 'ws'): void {
    // Update reported type based on the latest connected kind
    if (kind === 'ws') {
      this.connectionInfo.type = 'websocket';
    } else if (!this.ws || !this.ws.isConnected()) {
      this.connectionInfo.type = 'http';
    }
  }

  private handleUnderlyingClose(kind: 'http' | 'ws'): void {
    // Only emit close if both transports are down
    const wsConnected = this.ws?.isConnected() ?? false;
    const httpConnected = this.http.isConnected();
    if (!wsConnected && !httpConnected) {
      if (this.closeCallback) this.closeCallback();
      this.connectionInfo.status = 'disconnected';
    }
  }

  private ensureHttpUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('ws://')) return 'http://' + url.slice('ws://'.length);
    if (url.startsWith('wss://')) return 'https://' + url.slice('wss://'.length);
    return url;
  }

  private ensureWsUrl(url: string): string {
    if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
    if (url.startsWith('https://')) return 'wss://' + url.slice('https://'.length);
    if (url.startsWith('http://')) return 'ws://' + url.slice('http://'.length);
    return 'ws://' + url; // best-effort
  }
}
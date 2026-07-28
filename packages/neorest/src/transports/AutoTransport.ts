import { ClientTransport, MsgWrapper, ConnectionInfo } from '../core';
import { WebSocketTransport } from './WebSocketTransport';
import { HttpTransport } from './HttpTransport';

/**
 * Auto transport: start with HTTP long-polling, attempt WebSocket upgrade, and fallback to HTTP on failures.
 */
export class AutoTransport implements ClientTransport {
  private http: HttpTransport;
  private ws: WebSocketTransport | null = null;

  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;

  private authData: Record<string, string> = {};
  private connectionInfo: ConnectionInfo;
  private connectionSecret: string | null = null;
  private upgradeTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackPromise: Promise<void> | null = null;
  private isClosing = false;
  private isUpgrading = false;
  private messagesQueuedDuringUpgrade: MsgWrapper[] = [];

  constructor(private baseUrl: string) {
    this.http = new HttpTransport(this.ensureHttpUrl(baseUrl));
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url: baseUrl,
      type: 'http',
      status: 'disconnected'
    };
  }

  async connect(): Promise<void> {
    this.isClosing = false;
    // 1) Connect HTTP first
    await this.http.connect();
    this.connectionInfo.status = 'connected';
    this.connectionInfo.type = 'http';

    // wire callbacks to HTTP
    if (this.messageCallback) this.http.onMessage(this.messageCallback);
    if (this.closeCallback) this.http.onClose(() => this.handleUnderlyingClose('http'));
    if (this.openCallback) this.http.onOpen(() => this.handleUnderlyingOpen('http'));

    // Fire open for HTTP immediately (http transport already calls its open callback)
    // but ensure the consumer's onOpen is invoked at least once
    if (this.openCallback) this.openCallback();

    // 2) Attempt WS upgrade only after we know the server-issued secret,
    // so that the server can associate the WS transport with the same session.
    this.waitForSecretAndUpgrade();
  }

  disconnect(): void {
    this.isClosing = true;
    if (this.upgradeTimer) {
      clearTimeout(this.upgradeTimer);
      this.upgradeTimer = null;
    }
    try { 
      this.ws?.disconnect(); 
    } catch (error) {
      console.debug("Error disconnecting WebSocket:", error);
    }
    try { 
      this.http.disconnect(); 
    } catch (error) {
      console.debug("Error disconnecting HTTP:", error);
    }
    this.connectionInfo.status = 'disconnected';
  }

  send(message: MsgWrapper): void {
    if (this.isUpgrading || this.fallbackPromise) {
      this.messagesQueuedDuringUpgrade.push(message);
      return;
    }

    if (
      !this.isClosing
      && this.ws
      && !this.ws.isConnected()
      && !this.http.isConnected()
    ) {
      this.messagesQueuedDuringUpgrade.push(message);
      this.ws = null;
      this.connectionInfo.type = 'http';
      void this.restoreHttpFallback().catch((error) => {
        console.error('HTTP fallback failed:', error);
      });
      return;
    }

    // Prefer WS if connected; otherwise HTTP
    if (this.ws && this.ws.isConnected()) {
      try {
        this.ws.send(message);
        this.connectionInfo.type = 'websocket';
        return;
      } catch (error) {
        // WebSocket send failed, fallback to HTTP
        console.debug("WebSocket send failed, falling back to HTTP:", error);
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
    return (
      (this.ws?.isConnected?.() ?? false)
      || this.http.isConnected()
      || (
        !this.isClosing
        && (this.isUpgrading || this.fallbackPromise !== null || this.ws !== null)
      )
    );
  }

  setAuthentication(authData: Record<string, string>): void {
    this.authData = authData;
    this.http.setAuthentication(authData);
    if (this.ws) this.ws.setAuthentication(authData);
  }

  setConnectionSecret(secret: string): void {
    this.connectionSecret = secret;
    this.http.setConnectionSecret(secret);
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      ...this.connectionInfo,
      url: this.baseUrl,
      status: this.isConnected() ? 'connected' : 'disconnected',
      type: this.ws?.isConnected() ? 'websocket' : 'http',
    };
  }

  getConnectionMode(): 'auto' {
    return 'auto';
  }

  // Internals
  private async tryUpgradeToWebSocket(): Promise<void> {
    if (this.isClosing || this.ws?.isConnected() || this.isUpgrading) {
      return;
    }
    if (this.http.hasPendingSends()) {
      this.upgradeTimer = setTimeout(() => {
        this.upgradeTimer = null;
        void this.tryUpgradeToWebSocket();
      }, 25);
      return;
    }

    this.isUpgrading = true;
    try {
      let wsUrl = this.ensureWsUrl(this.baseUrl);
      
      // Add connection secret to WebSocket URL if available
      if (this.connectionSecret) {
        const url = new URL(wsUrl);
        url.searchParams.set('secret', this.connectionSecret);
        const upgradeInfo = this.http.getUpgradeInfo();
        if (upgradeInfo) {
          url.searchParams.set('clientId', upgradeInfo.clientId);
          url.searchParams.set('upgradeToken', upgradeInfo.token);
        }
        wsUrl = url.toString();
      }
      
      const ws = new WebSocketTransport(wsUrl);
      // propagate auth if set
      if (Object.keys(this.authData).length > 0) ws.setAuthentication(this.authData);

      // wire message/open/close to existing callbacks
      if (this.messageCallback) ws.onMessage(this.messageCallback);
      if (this.openCallback) ws.onOpen(() => this.handleUnderlyingOpen('ws'));
      if (this.closeCallback) ws.onClose(() => this.handleUnderlyingClose('ws'));

      await ws.connect();
      if (this.isClosing) {
        ws.disconnect();
        this.isUpgrading = false;
        return;
      }

      // Mark as upgraded
      this.ws = ws;
      this.connectionInfo.type = 'websocket';
      // Keep one active server transport per logical connection. If WebSocket
      // later fails, restore HTTP with a fresh transport/client id.
      this.http.disconnect();
      this.isUpgrading = false;
      this.flushUpgradeQueue(ws);
      this.openCallback?.();
    } catch (e) {
      // WS not available or failed; continue on HTTP silently
      this.isUpgrading = false;
      this.flushUpgradeQueue(this.http);
    }
  }

  private waitForSecretAndUpgrade(): void {
    const start = Date.now();
    const maxWaitMs = 2000;
    const tick = () => {
      if (this.connectionSecret) {
        this.upgradeTimer = null;
        void this.tryUpgradeToWebSocket();
        return;
      }
      if (Date.now() - start > maxWaitMs) {
        this.upgradeTimer = null;
        // Give up on waiting; stay on HTTP (will retry later on reconnects if any)
        return;
      }
      this.upgradeTimer = setTimeout(tick, 50);
    };
    this.upgradeTimer = setTimeout(tick, 50);
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
    if (this.isClosing) {
      return;
    }

    if (kind === 'ws') {
      if (!this.ws) {
        return;
      }
      this.ws = null;
      this.connectionInfo.type = 'http';
      void this.restoreHttpFallback().catch((error) => {
        console.error('HTTP fallback failed:', error);
      });
      return;
    }

    // Only emit close if both transports are down
    const wsConnected = this.ws?.isConnected() ?? false;
    const httpConnected = this.http.isConnected();
    if (!wsConnected && !httpConnected) {
      if (this.closeCallback) this.closeCallback();
      this.connectionInfo.status = 'disconnected';
    }
  }

  private restoreHttpFallback(): Promise<void> {
    if (this.fallbackPromise) {
      return this.fallbackPromise;
    }

    this.fallbackPromise = (async () => {
      // Give the server's WebSocket close event a brief head start so the
      // reconnect is not mistaken for an active-session takeover.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.isClosing) {
        return;
      }
      const http = new HttpTransport(this.ensureHttpUrl(this.baseUrl));
      if (this.connectionSecret) {
        http.setConnectionSecret(this.connectionSecret);
      }
      if (Object.keys(this.authData).length > 0) {
        http.setAuthentication(this.authData);
      }
      if (this.messageCallback) {
        http.onMessage(this.messageCallback);
      }
      http.onOpen(() => this.handleUnderlyingOpen('http'));
      http.onClose(() => this.handleUnderlyingClose('http'));
      this.http = http;

      try {
        await http.connect();
        this.connectionInfo.status = 'connected';
        this.connectionInfo.type = 'http';
        this.flushUpgradeQueue(http);
        this.openCallback?.();
      } catch (error) {
        this.connectionInfo.status = 'disconnected';
        this.closeCallback?.();
        throw error;
      }
    })().finally(() => {
      this.fallbackPromise = null;
    });

    return this.fallbackPromise;
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

  private flushUpgradeQueue(transport: ClientTransport): void {
    const messages = this.messagesQueuedDuringUpgrade.splice(0);
    for (const message of messages) {
      transport.send(message);
    }
  }
}

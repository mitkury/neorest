import {
  MsgWrapper,
  ClientTransport,
  ConnectionInfo,
  TransportUpgradeInfo,
} from '../core';

/**
 * HTTP-based communication transport using long polling
 */
export class HttpTransport implements ClientTransport {
  private connected = false;
  private session: AbortController | null = null;
  private connecting: Promise<void> | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollController: AbortController | null = null;
  private connectionInfo: ConnectionInfo;
  private authData: Record<string, string> = {};
  private pollDelay = 0;
  private pollFailures = 0;
  private maxPollFailures = 3;
  private clientId: string | null = null;
  private connectionSecret: string | null = null;
  private pendingSends = 0;
  private upgradeToken: string | null = null;
  private webTransportUrl: string | null = null;

  /**
   * Constructor
   * @param url - The URL to connect to
   */
  constructor(url: string) {
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url,
      type: 'http',
      status: 'disconnected'
    };
  }

  /**
   * Connect to the server
   */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;

    const session = new AbortController();
    this.session = session;
    this.connectionInfo.status = 'connecting';
    const connecting = this.openSession(session).finally(() => {
      if (this.connecting === connecting) this.connecting = null;
    });
    this.connecting = connecting;
    return connecting;
  }

  private async openSession(session: AbortController): Promise<void> {
    try {
      const res = await fetch(this.createTransportUrl().toString(), {
        method: 'GET',
        headers: this.createHeaders(),
        credentials: 'same-origin',
        signal: session.signal,
      });
      if (!this.isCurrentSession(session)) throw this.closedError();
      if (!res.ok) {
        throw new Error(`HTTP transport handshake failed: ${res.status}`);
      }
      const data = await res.json() as {
        clientId?: unknown;
        upgradeToken?: unknown;
        webTransportUrl?: unknown;
      };
      if (!this.isCurrentSession(session)) throw this.closedError();
      if (typeof data?.clientId !== 'string' || !data.clientId) {
        throw new Error('HTTP transport handshake returned an invalid clientId');
      }
      this.clientId = data.clientId;
      this.upgradeToken = typeof data.upgradeToken === 'string' ? data.upgradeToken : null;
      this.webTransportUrl = typeof data.webTransportUrl === 'string'
        ? data.webTransportUrl
        : null;
      this.connectionInfo.id = this.clientId;
    } catch (error) {
      if (this.isCurrentSession(session)) {
        this.connectionInfo.status = 'disconnected';
        this.session = null;
        session.abort();
      }
      throw error;
    }

    this.connected = true;
    this.pollFailures = 0;
    this.connectionInfo.status = 'connected';
    this.openCallback?.();
    this.schedulePoll(0);
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.session?.abort();
    this.session = null;
    this.connecting = null;
    this.clientId = null;
    this.upgradeToken = null;
    this.webTransportUrl = null;
    this.pendingSends = 0;
    this.connectionInfo.status = 'disconnected';
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollController?.abort();
    this.pollController = null;

    if (wasConnected && this.closeCallback) {
      this.closeCallback();
    }
  }

  /**
   * Send a message to the server
   * @param message - The message to send
   */
  send(message: MsgWrapper): void {
    const session = this.session;
    if (!this.connected || !session) {
      throw new Error('HTTP connection is not established');
    }

    this.pendingSends++;
    const doSend = async () => {
      try {
        // Add auth data to headers
        const headers = this.createHeaders({ 'Content-Type': 'application/json' });

        // Include clientId in URL
        const url = this.createTransportUrl();
        if (this.clientId) {
          url.searchParams.set('clientId', this.clientId);
        }

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
          credentials: 'same-origin',
          signal: session.signal,
        });

        if (!this.isCurrentSession(session)) return;
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        // Handle immediate response message if present
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          this.dispatchPayload(await response.json(), session);
        }
      } catch (error) {
        if (!this.isCurrentSession(session)) return;
        console.error('Error sending message:', error);
        this.disconnect();
      } finally {
        if (this.isCurrentSession(session)) this.pendingSends--;
      }
    };

    // Fire-and-forget to comply with interface signature
    void doSend();
  }

  /**
   * Register a callback for when a message is received
   * @param callback - The callback to register
   */
  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Register a callback for when the connection is closed
   * @param callback - The callback to register
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  /**
   * Register a callback for when the connection is opened
   * @param callback - The callback to register
   */
  onOpen(callback: () => void): void {
    this.openCallback = callback;
  }

  /**
   * Check if the connection is established
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set authentication data
   * @param authData - The authentication data
   */
  setAuthentication(authData: Record<string, string>): void {
    this.authData = authData;
  }

  setConnectionSecret(secret: string): void {
    this.connectionSecret = secret;
  }

  hasPendingSends(): boolean {
    return this.pendingSends > 0;
  }

  getUpgradeInfo(): TransportUpgradeInfo | null {
    if (!this.clientId || !this.upgradeToken) {
      return null;
    }
    return {
      clientId: this.clientId,
      token: this.upgradeToken,
      ...(this.webTransportUrl ? { webTransportUrl: this.webTransportUrl } : {}),
    };
  }

  /**
   * Get information about the connection
   * @returns Connection information
   */
  getConnectionInfo(): ConnectionInfo {
    return this.connectionInfo;
  }

  getConnectionMode(): 'http' {
    return 'http';
  }

  /**
   * Poll for messages from the server
   */
  private schedulePoll(delay = this.pollDelay): void {
    if (!this.connected || this.pollTimer) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollForMessages();
    }, delay);
  }

  private async pollForMessages(): Promise<void> {
    const session = this.session;
    if (!this.connected || !this.clientId || !session) {
      return;
    }

    const controller = new AbortController();
    this.pollController = controller;
    try {
      const pollUrl = this.createTransportUrl();
      pollUrl.searchParams.set('poll', 'true');
      pollUrl.searchParams.set('clientId', this.clientId);
      const response = await fetch(pollUrl.toString(), {
        headers: this.createHeaders(),
        signal: controller.signal,
        credentials: 'same-origin',
      });

      if (!this.isCurrentSession(session)) return;
      if (response.status !== 204) {
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          this.dispatchPayload(await response.json(), session);
        }
      }
      if (this.isCurrentSession(session)) this.pollFailures = 0;
    } catch (error) {
      if (!this.isCurrentSession(session) || controller.signal.aborted) {
        return;
      }
      console.error('Error polling for messages:', error);
      this.pollFailures++;
      if (this.pollFailures >= this.maxPollFailures) {
        console.error(`Max poll failures (${this.maxPollFailures}) reached, disconnecting`);
        this.disconnect();
        return;
      }
    } finally {
      if (this.isCurrentSession(session) && this.pollController === controller) {
        this.pollController = null;
        this.schedulePoll();
      }
    }
  }

  private isCurrentSession(session: AbortController): boolean {
    return this.session === session && !session.signal.aborted;
  }

  private closedError(): DOMException {
    return new DOMException('HTTP connection closed', 'AbortError');
  }

  private createTransportUrl(): URL {
    const url = new URL(this.connectionInfo.url);
    url.pathname = '/.neorest';
    if (this.connectionSecret) {
      url.searchParams.set('secret', this.connectionSecret);
    }
    return url;
  }

  private createHeaders(additional: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/json',
      ...this.authData,
      ...additional,
    };
  }

  private dispatchPayload(payload: unknown, session: AbortController): void {
    if (!this.isCurrentSession(session) || !payload || !this.messageCallback) {
      return;
    }
    if (Array.isArray(payload)) {
      for (const message of payload) {
        if (!this.isCurrentSession(session)) return;
        this.messageCallback(message as MsgWrapper);
      }
      return;
    }
    this.messageCallback(payload as MsgWrapper);
  }
}

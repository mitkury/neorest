import {
  ClientTransport,
  ConnectionInfo,
  MsgWrapper,
  TransportUpgradeInfo,
  WebTransportClientOptions,
  WebTransportSessionLike,
  WebTransportSessionTransport,
} from '../core';

type WebTransportConstructor = new (
  url: string,
  options?: {
    allowPooling?: boolean;
    headers?: Record<string, string>;
    serverCertificateHashes?: WebTransportClientOptions['serverCertificateHashes'];
  },
) => WebTransportSessionLike;

/**
 * Browser WebTransport client. Authentication happens on the regular HTTP
 * handshake; the returned single-use ticket is then exchanged over HTTP/3.
 */
export class WebTransportTransport implements ClientTransport {
  private delegate: WebTransportSessionTransport | null = null;
  private authData: Record<string, string> = {};
  private connectionSecret: string | null = null;
  private upgradeInfo: TransportUpgradeInfo | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connectionInfo: ConnectionInfo;

  constructor(
    private readonly baseUrl: string,
    private readonly options: WebTransportClientOptions = {},
  ) {
    this.validateOptions();
    this.connectionInfo = {
      id: Math.random().toString(36).substring(2, 15),
      url: baseUrl,
      type: 'webtransport',
      status: 'disconnected',
    };
  }

  async connect(): Promise<void> {
    if (this.delegate?.isConnected()) return;
    this.connectionInfo.status = 'connecting';
    try {
      const upgradeInfo = this.upgradeInfo ?? await this.bootstrap();
      if (!upgradeInfo.webTransportUrl) {
        throw new Error('Server did not advertise a WebTransport endpoint');
      }
      this.connectionInfo.id = upgradeInfo.clientId;
      const Constructor = (globalThis as { WebTransport?: WebTransportConstructor }).WebTransport;
      if (!Constructor) {
        throw new Error('WebTransport is not available in this runtime');
      }

      const url = new URL(upgradeInfo.webTransportUrl);
      url.searchParams.set('clientId', upgradeInfo.clientId);
      url.searchParams.set('upgradeToken', upgradeInfo.token);
      if (this.connectionSecret) url.searchParams.set('secret', this.connectionSecret);

      const session = new Constructor(url.toString(), {
        allowPooling: false,
        ...(Object.keys(this.authData).length ? { headers: this.authData } : {}),
        ...(this.options.serverCertificateHashes
          ? { serverCertificateHashes: this.options.serverCertificateHashes }
          : {}),
      });
      const delegate = new WebTransportSessionTransport(session, {
        role: 'client',
        maxFrameBytes: this.options.maxFrameBytes,
        maxBufferedBytes: this.options.maxBufferedBytes,
        streamTimeoutMs: this.options.streamTimeoutMs,
      });
      if (this.messageCallback) delegate.onMessage(this.messageCallback);
      delegate.onOpen(() => {
        this.connectionInfo.status = 'connected';
        this.openCallback?.();
      });
      delegate.onClose(() => {
        this.connectionInfo.status = 'disconnected';
        this.closeCallback?.();
      });
      this.delegate = delegate;
      await withTimeout(
        delegate.connect(),
        this.options.connectTimeoutMs ?? 10_000,
        'WebTransport connection',
      );
      this.upgradeInfo = null;
    } catch (error) {
      this.connectionInfo.status = 'disconnected';
      this.delegate?.disconnect();
      this.delegate = null;
      throw error;
    }
  }

  disconnect(): void {
    this.delegate?.disconnect();
    this.delegate = null;
    this.connectionInfo.status = 'disconnected';
  }

  send(message: MsgWrapper): void {
    if (!this.delegate) throw new Error('WebTransport connection is not established');
    this.delegate.send(message);
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
    this.delegate?.onMessage(callback);
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
    this.delegate?.onClose(callback);
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
    this.delegate?.onOpen(callback);
  }

  isConnected(): boolean {
    return this.delegate?.isConnected() ?? false;
  }

  setAuthentication(authData: Record<string, string>): void {
    this.authData = { ...authData };
  }

  setConnectionSecret(secret: string): void {
    this.connectionSecret = secret;
  }

  setUpgradeInfo(info: TransportUpgradeInfo): void {
    this.upgradeInfo = { ...info };
  }

  getConnectionInfo(): ConnectionInfo {
    return this.connectionInfo;
  }

  getConnectionMode(): 'webtransport' {
    return 'webtransport';
  }

  private async bootstrap(): Promise<TransportUpgradeInfo> {
    const url = new URL(this.baseUrl);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    url.pathname = '/.neorest';
    if (this.connectionSecret) url.searchParams.set('secret', this.connectionSecret);
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...this.authData },
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`WebTransport bootstrap failed: ${response.status}`);
    }
    const value = await response.json() as Record<string, unknown>;
    if (
      typeof value.clientId !== 'string'
      || !value.clientId
      || typeof value.upgradeToken !== 'string'
      || !value.upgradeToken
    ) {
      throw new Error('WebTransport bootstrap returned an invalid upgrade ticket');
    }
    return {
      clientId: value.clientId,
      token: value.upgradeToken,
      webTransportUrl: typeof value.webTransportUrl === 'string'
        ? value.webTransportUrl
        : undefined,
    };
  }

  private validateOptions(): void {
    for (const [name, value] of Object.entries(this.options)) {
      if (
        name !== 'serverCertificateHashes'
        && value !== undefined
        && (!Number.isInteger(value) || (value as number) <= 0)
      ) {
        throw new Error(`${name} must be a positive integer`);
      }
    }
    for (const hash of this.options.serverCertificateHashes ?? []) {
      const byteLength = hash.value instanceof ArrayBuffer
        ? hash.value.byteLength
        : ArrayBuffer.isView(hash.value) ? hash.value.byteLength : -1;
      if (
        typeof hash.algorithm !== 'string'
        || hash.algorithm.toLowerCase() !== 'sha-256'
        || byteLength !== 32
      ) {
        throw new Error(
          'WebTransport certificate hashes must be 32-byte sha-256 values',
        );
      }
    }
    if (
      this.options.maxBufferedBytes !== undefined
      && this.options.maxBufferedBytes < (this.options.maxFrameBytes ?? 1024 * 1024)
    ) {
      throw new Error('maxBufferedBytes must be at least as large as maxFrameBytes');
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

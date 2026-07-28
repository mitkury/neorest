import { randomBytes } from 'node:crypto';
import type {
  ConnectionIdentity,
  ConnectionSecret,
  WebTransportSessionLike,
} from '../../core';

export interface WebTransportServerOptions {
  /**
   * UDP port used by HTTP/3. Defaults to the NodeRouter TCP port.
   */
  port?: number;
  hostname?: string;
  /**
   * Browser-visible endpoint, useful behind a proxy or NAT.
   */
  publicUrl?: string;
  cert?: string;
  privateKey?: string;
  secret?: string;
  maxConnections?: number;
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  streamTimeoutMs?: number;
  startupTimeoutMs?: number;
}

export interface AuthorizedWebTransportSession {
  reconnectSecret: ConnectionSecret;
  identity: ConnectionIdentity | null;
  allowActiveReplacement: boolean;
}

interface Http3ServerLike {
  ready: Promise<unknown>;
  closed: Promise<unknown>;
  startServer(): void;
  stopServer(): void;
  address(): { port: number; host: string } | null;
  setRequestCallback(
    callback: (request: { header: Record<string, string> }) => Promise<Record<string, unknown>>,
  ): void;
  sessionStream(path: string): ReadableStream<WebTransportSessionLike>;
}

interface Http3ServerConstructor {
  new (options: Record<string, unknown>): Http3ServerLike;
}

/**
 * Small provider boundary around the optional HTTP/3 implementation. Neorest's
 * protocol only depends on WebTransport-shaped sessions, so this host can be
 * replaced when Node gains a native WebTransport server.
 */
export class WebTransportServerHost {
  private server: Http3ServerLike | null = null;
  private sessionReader: ReadableStreamDefaultReader<WebTransportSessionLike> | null = null;
  private accepting = false;

  constructor(
    private readonly options: Required<
      Pick<WebTransportServerOptions, 'port' | 'hostname' | 'cert' | 'privateKey'>
    > & WebTransportServerOptions,
    private readonly authorize: (
      url: URL,
      headers: Record<string, string>,
    ) => AuthorizedWebTransportSession | null,
    private readonly onSession: (
      session: WebTransportSessionLike,
      authorization: AuthorizedWebTransportSession,
    ) => Promise<void>,
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    if (Number(process.versions.node.split('.')[0]) < 20) {
      throw new Error('WebTransport server support requires Node.js 20 or newer');
    }

    let Http3Server: Http3ServerConstructor;
    try {
      await import('@fails-components/webtransport-transport-http3-quiche');
      const provider = await import('@fails-components/webtransport') as unknown as {
        Http3Server: Http3ServerConstructor;
        quicheLoaded: Promise<unknown>;
      };
      await provider.quicheLoaded;
      Http3Server = provider.Http3Server;
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : '';
      throw new Error(
        'WebTransport is enabled but its optional server packages are not installed. '
        + 'Install @fails-components/webtransport and '
        + `@fails-components/webtransport-transport-http3-quiche.${detail}`,
      );
    }

    const server = new Http3Server({
      port: this.options.port,
      host: this.options.hostname,
      secret: this.options.secret ?? randomBytes(32).toString('hex'),
      cert: this.options.cert,
      privKey: this.options.privateKey,
      ...(this.options.maxConnections !== undefined
        ? { maxConnections: this.options.maxConnections }
        : {}),
      defaultDatagramsReadableMode: 'bytes',
      reliability: 'unreliableOnly',
    });
    const sessions = server.sessionStream('/.neorest');
    server.setRequestCallback(async ({ header }) => {
      const rawPath = header[':path'];
      if (typeof rawPath !== 'string') throw new Error('Missing WebTransport request path');
      const authority = header[':authority'] || `${this.options.hostname}:${this.options.port}`;
      const url = new URL(rawPath, `https://${authority}`);
      if (url.pathname !== '/.neorest') throw new Error('Unknown WebTransport endpoint');
      const authorization = this.authorize(url, header);
      if (!authorization) throw new Error('Unauthorized WebTransport session');
      return {
        path: '/.neorest',
        status: 200,
        userData: authorization,
        header: { ...header, ':path': '/.neorest' },
      };
    });

    this.server = server;
    this.sessionReader = sessions.getReader();
    server.startServer();
    try {
      await withTimeout(
        server.ready,
        this.options.startupTimeoutMs ?? 10_000,
        'WebTransport server startup',
      );
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.accepting = true;
    void this.acceptSessions();
  }

  async stop(): Promise<void> {
    this.accepting = false;
    const reader = this.sessionReader;
    this.sessionReader = null;
    await reader?.cancel().catch(() => {});
    try {
      reader?.releaseLock();
    } catch {
      // Best effort.
    }
    const server = this.server;
    this.server = null;
    if (!server) return;
    try {
      server.stopServer();
      await withTimeout(server.closed, 5_000, 'WebTransport server shutdown').catch(() => {});
    } catch {
      // The native provider can already be stopped after a startup failure.
    }
  }

  publicUrl(requestAuthority?: string): string {
    if (this.options.publicUrl) {
      const configured = new URL(this.options.publicUrl);
      configured.pathname = '/.neorest';
      return configured.toString();
    }
    const address = this.server?.address();
    const authorityHost = requestAuthority
      ? new URL(`https://${requestAuthority}`).hostname
      : this.options.hostname;
    const host = authorityHost.startsWith('[')
      ? authorityHost
      : authorityHost.includes(':') ? `[${authorityHost}]` : authorityHost;
    return `https://${host}:${address?.port ?? this.options.port}/.neorest`;
  }

  private async acceptSessions(): Promise<void> {
    const reader = this.sessionReader;
    if (!reader) return;
    try {
      while (this.accepting) {
        const result = await reader.read();
        if (result.done) return;
        const session = result.value as WebTransportSessionLike & {
          userData?: AuthorizedWebTransportSession;
        };
        const authorization = session.userData;
        if (!authorization) {
          session.close({ closeCode: 1, reason: 'Missing authorization context' });
          continue;
        }
        void this.onSession(session, authorization).catch(() => {
          session.close({ closeCode: 1, reason: 'Connection rejected' });
        });
      }
    } catch (error) {
      if (this.accepting) console.error('WebTransport session listener failed:', error);
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

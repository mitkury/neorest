import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import {
  createServer as createHttpServer,
  Server as HttpServer,
} from 'http';
import {
  createServer as createHttpsServer,
  Server as HttpsServer,
} from 'https';
import type { Duplex } from 'stream';
import { randomUUID } from 'crypto';
import type { ConnectionIdentity, ConnectionSecret } from '../../core';
import {
  isMessageWrapper,
  Router,
  WebTransportSessionTransport,
  type ServerAdapter,
} from '../../core';
import { HttpTransport } from '../transports/HttpTransport';
import {
  WebTransportServerHost,
  type AuthorizedWebTransportSession,
  type WebTransportServerOptions,
} from './WebTransportServerHost';
export type { WebTransportServerOptions } from './WebTransportServerHost';

export interface CorsOptions {
  /**
   * Allowed browser origins. Defaults to "*".
   */
  origin?: string | string[] | ((origin: string) => boolean);
  credentials?: boolean;
  allowedHeaders?: string[];
}

export interface ConnectionAuthRequest {
  transport: 'http' | 'websocket';
  url: URL;
  /**
   * Standards-compatible headers, ready for APIs such as Better Auth.
   */
  headers: Headers;
  rawHeaders: IncomingHttpHeaders;
  method: string;
  remoteAddress?: string;
}

export type ConnectionAuthenticator = (
  request: ConnectionAuthRequest,
) =>
  | ConnectionIdentity
  | null
  | Promise<ConnectionIdentity | null>;

export interface HttpRateLimitOptions {
  windowMs?: number;
  maxRequestsPerIp?: number;
  key?: (request: IncomingMessage) => string;
}

export interface NodeRequestHandlers {
  /**
   * Returns false without writing a response when the request does not belong
   * to Neorest, allowing the host application to handle it.
   */
  request: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  /**
   * Returns false when the upgrade path does not belong to Neorest.
   */
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean>;
}

/**
 * Node server adapter options.
 */
export interface NodeServerAdapterOptions {
  port?: number;
  hostname?: string;
  /**
   * Shared logical connection cap passed through from Router options.
   */
  maxConnections?: number | false;
  /**
   * @deprecated Use NodeRouter.createHandlers() to compose Neorest with an
   * existing Node/SvelteKit server.
   */
  expressApp?: any;
  ssl?: {
    key: string;
    cert: string;
  };
  disableWebSocket?: boolean;
  /**
   * Enable the optional HTTP/3 WebTransport listener. WebTransport uses UDP
   * and can share the same numeric port as the TCP HTTP server.
   */
  webTransport?: false | WebTransportServerOptions;
  disableHttpRoutes?: boolean;
  maxRequestBodyBytes?: number;
  /**
   * Time an empty HTTP poll is held before returning 204. Defaults to 25s.
   */
  longPollTimeoutMs?: number;
  maxPendingHandshakes?: number;
  cors?: CorsOptions | false;
  /**
   * Authenticate the native HTTP or WebSocket handshake. Returning null
   * rejects it. The returned identity is frozen on ServerConnection.
   */
  authenticateConnection?: ConnectionAuthenticator;
  /**
   * HTTP request limit per client address. Defaults to 600 requests/minute.
   * Set false to disable.
   */
  httpRateLimit?: HttpRateLimitOptions | false;
}

type HttpUpgradeEntry = {
  token: string;
  expiresAt: number;
  secret?: ConnectionSecret;
  identity: ConnectionIdentity | null;
};

type RateLimitEntry = {
  startedAt: number;
  count: number;
};

/**
 * Node.js server adapter. It can own a standalone server or expose handlers
 * that a host server composes with SvelteKit/Express/another framework.
 */
export class NodeServerAdapter implements ServerAdapter {
  private readonly options: NodeServerAdapterOptions;
  private router?: Router;
  private server: HttpServer | HttpsServer | null = null;
  private wsServer: any | null = null;
  private webTransportServer: WebTransportServerHost | null = null;
  private initialized = false;
  private standalone = false;
  private readonly httpConnections = new Map<string, HttpTransport>();
  private readonly httpConnectionPromises = new Map<string, Promise<HttpTransport>>();
  private readonly httpUpgradeTokens = new Map<string, HttpUpgradeEntry>();
  private readonly requestRateLimits = new Map<string, RateLimitEntry>();

  constructor(options?: NodeServerAdapterOptions) {
    this.options = {
      port: 8080,
      hostname: 'localhost',
      maxRequestBodyBytes: 1024 * 1024,
      longPollTimeoutMs: 25_000,
      maxPendingHandshakes: 10_000,
      cors: { origin: '*' },
      httpRateLimit: {
        windowMs: 60_000,
        maxRequestsPerIp: 600,
      },
      ...options,
    };
    this.validateOptions();
  }

  async initialize(router: Router): Promise<void> {
    await this.prepare(router);
    if (this.server) {
      return;
    }
    this.standalone = true;
    const requestListener = (req: IncomingMessage, res: ServerResponse) => {
      void this.handleStandaloneRequest(req, res);
    };
    this.server = this.options.ssl?.key && this.options.ssl?.cert
      ? createHttpsServer(
          { key: this.options.ssl.key, cert: this.options.ssl.cert },
          requestListener,
        )
      : createHttpServer(requestListener);

    this.server.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head).then((handled) => {
        if (!handled && !socket.destroyed) {
          socket.destroy();
        }
      });
    });
    console.log(`Initializing Node.js server on ${this.options.hostname}:${this.options.port}`);
  }

  /**
   * Prepare request/upgrade handlers without creating or listening on a server.
   */
  async createHandlers(router: Router): Promise<NodeRequestHandlers> {
    await this.prepare(router);
    return {
      request: (req, res) => this.handleRequest(req, res),
      upgrade: (req, socket, head) => this.handleUpgrade(req, socket, head),
    };
  }

  async start(): Promise<void> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }
    if (!this.standalone || !this.server) {
      // Embedded handlers are started by their host server.
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.options.port, this.options.hostname);
    });
    console.log(`Server listening on http://${this.options.hostname}:${this.options.port}`);
  }

  async stop(): Promise<void> {
    for (const transport of this.httpConnections.values()) {
      transport.disconnect();
    }
    this.httpConnections.clear();
    this.httpConnectionPromises.clear();
    this.httpUpgradeTokens.clear();
    this.requestRateLimits.clear();
    await this.webTransportServer?.stop();
    this.webTransportServer = null;

    if (this.wsServer) {
      await new Promise<void>((resolve) => {
        this.wsServer!.clients.forEach((client: any) => client.terminate());
        this.wsServer!.close(() => resolve());
      });
      this.wsServer = null;
    }

    if (this.standalone && this.server) {
      const server = this.server;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
      });
    }
    this.server = null;
    this.initialized = false;
    this.standalone = false;
    console.log('Server stopped');
  }

  /**
   * Handle a request only when it targets /.neorest or a registered plain
   * HTTP route. Unknown requests are left untouched for an embedding host.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }
    const url = this.requestUrl(req);
    const isTransport = url.pathname === '/.neorest';
    const isRoute = !this.options.disableHttpRoutes && this.router.hasHttpRoute(url.pathname);
    if (!isTransport && !isRoute) {
      return false;
    }

    try {
      if (!this.isOriginAllowed(req.headers.origin)) {
        this.respond(req, res, 403, { error: 'Origin not allowed' });
        return true;
      }
      if (!this.consumeHttpRequestAllowance(req)) {
        const windowMs = this.httpRateLimitOptions()?.windowMs ?? 60_000;
        this.respond(
          req,
          res,
          429,
          { error: 'HTTP request rate limit exceeded' },
          { 'Retry-After': String(Math.max(1, Math.ceil(windowMs / 1000))) },
        );
        return true;
      }

      if (req.method === 'OPTIONS') {
        this.respond(req, res, 204);
        return true;
      }
      if (isTransport) {
        await this.handleTransportRequest(req, res, url);
      } else {
        await this.handlePlainHttpRoute(req, res, url);
      }
    } catch (error) {
      console.error('Unhandled HTTP request error:', error);
      if (!res.headersSent) {
        this.respond(req, res, 500, { error: 'Internal server error' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return true;
  }

  /**
   * Handle WebSocket upgrades only at /.neorest.
   */
  async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<boolean> {
    try {
      return await this.handleUpgradeRequest(request, socket, head);
    } catch (error) {
      console.error('Unhandled WebSocket upgrade error:', error);
      this.rejectUpgrade(socket, 500, 'Internal server error');
      return true;
    }
  }

  private async handleUpgradeRequest(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<boolean> {
    if (!this.router || !this.wsServer) {
      return false;
    }
    const url = this.requestUrl(request);
    if (url.pathname !== '/.neorest' && !(this.standalone && url.pathname === '/')) {
      return false;
    }
    if (!this.isOriginAllowed(request.headers.origin)) {
      this.rejectUpgrade(socket, 403, 'Origin not allowed');
      return true;
    }
    if (!this.consumeHttpRequestAllowance(request)) {
      this.rejectUpgrade(socket, 429, 'Rate limit exceeded');
      return true;
    }

    const authenticatedIdentity = await this.authenticate(request, url, 'websocket');
    if (this.options.authenticateConnection && !authenticatedIdentity) {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return true;
    }

    const reconnectSecret = url.searchParams.get('secret');
    if (!this.router.canAcceptConnection(reconnectSecret)) {
      this.rejectUpgrade(socket, 503, 'Server connection limit reached');
      return true;
    }
    const hadHttpConnection = Boolean(
      url.searchParams.get('clientId')
      && (
        this.httpConnections.has(url.searchParams.get('clientId')!)
        || this.httpConnectionPromises.has(url.searchParams.get('clientId')!)
      ),
    );
    const upgradeEntry = this.consumeHttpUpgradeToken(
      url.searchParams.get('clientId'),
      url.searchParams.get('upgradeToken'),
      reconnectSecret,
    );
    if (
      upgradeEntry
      && upgradeEntry.identity?.id !== authenticatedIdentity?.id
    ) {
      this.rejectUpgrade(socket, 403, 'Connection identity mismatch');
      return true;
    }
    const identity = upgradeEntry?.identity ?? authenticatedIdentity;

    this.wsServer.handleUpgrade(request, socket as any, head, (ws: any) => {
      void this.handleWebSocketConnection(
        ws,
        reconnectSecret,
        Boolean(upgradeEntry && hadHttpConnection),
        identity,
      );
    });
    return true;
  }

  private async prepare(router: Router): Promise<void> {
    if (this.initialized) {
      if (this.router !== router) {
        throw new Error('NodeServerAdapter is already initialized for another router');
      }
      return;
    }
    this.router = router;
    this.initialized = true;
    if (!this.options.disableWebSocket) {
      try {
        const { WebSocketServer } = await import('ws');
        this.wsServer = new WebSocketServer({
          noServer: true,
          maxPayload: this.options.maxRequestBodyBytes,
        });
      } catch {
        this.wsServer = null;
      }
    }
    if (this.options.webTransport) {
      const configured = this.options.webTransport;
      const cert = configured.cert ?? this.options.ssl?.cert;
      const privateKey = configured.privateKey ?? this.options.ssl?.key;
      if (!cert || !privateKey) {
        throw new Error(
          'WebTransport requires a TLS certificate and private key in '
          + 'webTransport or ssl options',
        );
      }
      this.webTransportServer = new WebTransportServerHost(
        {
          ...configured,
          port: configured.port ?? this.options.port ?? 8080,
          hostname: configured.hostname ?? this.options.hostname ?? 'localhost',
          cert,
          privateKey,
          maxConnections: configured.maxConnections ?? (
            this.options.maxConnections === false
              ? undefined
              : this.options.maxConnections ?? 10_000
          ),
        },
        (url, headers) => this.authorizeWebTransport(url, headers),
        (session, authorization) => this.handleWebTransportConnection(
          session,
          authorization,
        ),
      );
      try {
        await this.webTransportServer.start();
      } catch (error) {
        this.webTransportServer = null;
        this.initialized = false;
        this.router = undefined;
        throw error;
      }
    }
  }

  private async handleStandaloneRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const handled = await this.handleRequest(req, res);
    if (!handled) {
      this.respond(req, res, 404, { error: 'Not found' });
    }
  }

  private async handleWebSocketConnection(
    socket: any,
    reconnectSecret: string | null,
    allowActiveReplacement: boolean,
    identity: ConnectionIdentity | null,
  ): Promise<void> {
    if (!this.router) return;
    const { WebSocketTransport } = await import('../transports/WebSocketTransport');
    const transport = new WebSocketTransport(socket as any);
    try {
      await this.router.handleNewConnection(
        transport as any,
        reconnectSecret as ConnectionSecret,
        allowActiveReplacement,
        identity,
      );
    } catch (error) {
      console.error('Rejected WebSocket connection:', error);
      socket.close(1008, 'Connection rejected');
    }
  }

  private async handleTransportRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const clientId = url.searchParams.get('clientId');
    const isPoll = url.searchParams.get('poll') === 'true';
    const reconnectSecret = url.searchParams.get('secret');

    if (!clientId) {
      if (req.method !== 'GET' || isPoll) {
        this.respond(req, res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
        return;
      }
      const identity = await this.authenticate(req, url, 'http');
      if (this.options.authenticateConnection && !identity) {
        this.respond(req, res, 401, { error: 'Unauthorized' });
        return;
      }
      if (!this.router?.canAcceptConnection(reconnectSecret)) {
        this.respond(req, res, 503, { error: 'Server connection limit reached' });
        return;
      }
      this.pruneInactiveHttpConnections();
      this.pruneExpiredHttpUpgradeTokens();
      if (this.httpUpgradeTokens.size >= (this.options.maxPendingHandshakes ?? 10_000)) {
        this.respond(req, res, 503, { error: 'Too many pending HTTP handshakes' });
        return;
      }
      const newClientId = randomUUID();
      const upgradeToken = randomUUID();
      this.httpUpgradeTokens.set(newClientId, {
        token: upgradeToken,
        expiresAt: Date.now() + 30_000,
        secret: reconnectSecret as ConnectionSecret | undefined,
        identity,
      });
      this.respond(req, res, 200, {
        clientId: newClientId,
        upgradeToken,
        ...(this.webTransportServer
          ? { webTransportUrl: this.webTransportServer.publicUrl(req.headers.host) }
          : {}),
      });
      return;
    }

    const existingTransport = this.httpConnections.get(clientId);
    if (existingTransport && !existingTransport.isConnected()) {
      this.httpConnections.delete(clientId);
    }
    if (!this.httpConnections.has(clientId) && !this.isIssuedHttpClientId(clientId)) {
      this.respond(req, res, 401, { error: 'Unknown or expired HTTP clientId' });
      return;
    }

    const transport = await this.getOrCreateHttpTransport(clientId, reconnectSecret);
    if (isPoll) {
      if (req.method !== 'GET') {
        this.respond(req, res, 405, { error: 'Method not allowed' }, { Allow: 'GET' });
        return;
      }
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      req.once('aborted', abort);
      res.once('close', abort);
      const messages = await transport.waitForMessages(
        this.options.longPollTimeoutMs ?? 25_000,
        abortController.signal,
      );
      req.off('aborted', abort);
      res.off('close', abort);
      if (res.writableEnded || res.destroyed) {
        return;
      }
      if (messages.length > 0) {
        this.respond(req, res, 200, messages);
      } else {
        this.respond(req, res, 204);
      }
      return;
    }

    if (req.method !== 'POST') {
      this.respond(req, res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
      return;
    }

    let body: string;
    try {
      body = await this.readRequestBody(req);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        this.respond(req, res, 413, { error: error.message });
        return;
      }
      throw error;
    }

    try {
      const message = JSON.parse(body);
      if (!isMessageWrapper(message)) {
        throw new Error('Invalid message wrapper');
      }
      transport.processMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const responseMessages = transport.getQueuedMessages();
      if (responseMessages.length > 0) {
        this.respond(req, res, 200, responseMessages);
      } else {
        this.respond(req, res, 202);
      }
    } catch (error) {
      console.error('Error processing HTTP message:', error);
      this.respond(req, res, 400, { error: 'Invalid message format' });
    }
  }

  private async handlePlainHttpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (!this.router) return;
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
      this.respond(
        req,
        res,
        405,
        { error: 'Method not allowed' },
        { Allow: 'GET, POST, DELETE, OPTIONS' },
      );
      return;
    }

    let rawBody = '';
    if (method === 'POST' || method === 'DELETE') {
      try {
        rawBody = await this.readRequestBody(req);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          this.respond(req, res, 413, { error: error.message });
          return;
        }
        throw error;
      }
    }

    let data: any = null;
    if (method === 'GET') {
      data = Object.fromEntries(url.searchParams.entries());
    } else if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        this.respond(req, res, 400, { error: 'Invalid JSON body' });
        return;
      }
    }

    const result = await this.router.executeHttpRoute(
      method,
      url.pathname,
      data,
      req.headers as Record<string, string>,
    );
    this.respond(req, res, result.status, result.body, {
      'Content-Type': result.contentType || 'application/json',
    });
  }

  private async getOrCreateHttpTransport(
    clientId: string,
    reconnectSecret: string | null,
  ): Promise<HttpTransport> {
    const existing = this.httpConnections.get(clientId);
    if (existing) return existing;
    const pending = this.httpConnectionPromises.get(clientId);
    if (pending) return pending;

    const connectionPromise = (async () => {
      console.log(`New HTTP client connection: ${clientId}`);
      const transport = new HttpTransport(
        clientId,
        Math.max(30_000, (this.options.longPollTimeoutMs ?? 25_000) + 5_000),
      );
      const entry = this.httpUpgradeTokens.get(clientId);
      const connection = await this.router!.handleNewConnection(
        transport,
        reconnectSecret as ConnectionSecret,
        false,
        entry?.identity ?? null,
      );
      if (entry) {
        entry.secret = connection.getSecret();
      }
      this.httpConnections.set(clientId, transport);
      return transport;
    })();
    this.httpConnectionPromises.set(clientId, connectionPromise);
    try {
      return await connectionPromise;
    } finally {
      this.httpConnectionPromises.delete(clientId);
    }
  }

  private authenticate(
    req: IncomingMessage,
    url: URL,
    transport: 'http' | 'websocket',
  ): Promise<ConnectionIdentity | null> {
    if (!this.options.authenticateConnection) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.options.authenticateConnection({
      transport,
      url,
      headers: this.toWebHeaders(req.headers),
      rawHeaders: req.headers,
      method: req.method || 'GET',
      remoteAddress: req.socket.remoteAddress,
    })).then((identity) => {
      if (!identity) return null;
      if (typeof identity.id !== 'string' || !identity.id) {
        throw new Error('authenticateConnection must return an identity with a non-empty id');
      }
      return Object.freeze({ ...identity });
    });
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
    const maxBytes = this.options.maxRequestBodyBytes ?? 1024 * 1024;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;
      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          settled = true;
          reject(new RequestBodyTooLargeError(maxBytes));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(Buffer.concat(chunks).toString('utf8'));
        }
      });
      req.on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      req.on('aborted', () => {
        if (!settled) {
          settled = true;
          reject(new Error('Request aborted'));
        }
      });
    });
  }

  private consumeHttpUpgradeToken(
    clientId: string | null,
    token: string | null,
    reconnectSecret: string | null,
  ): HttpUpgradeEntry | null {
    if (!clientId || !token || !reconnectSecret) return null;
    const entry = this.httpUpgradeTokens.get(clientId);
    if (
      !entry
      || entry.expiresAt < Date.now()
      || entry.token !== token
      || entry.secret !== reconnectSecret
    ) {
      return null;
    }
    this.httpUpgradeTokens.delete(clientId);
    return entry;
  }

  private isIssuedHttpClientId(clientId: string): boolean {
    const entry = this.httpUpgradeTokens.get(clientId);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.httpUpgradeTokens.delete(clientId);
      return false;
    }
    return true;
  }

  private pruneExpiredHttpUpgradeTokens(): void {
    const now = Date.now();
    for (const [clientId, entry] of this.httpUpgradeTokens) {
      if (entry.expiresAt < now) this.httpUpgradeTokens.delete(clientId);
    }
  }

  private pruneInactiveHttpConnections(): void {
    for (const [clientId, transport] of this.httpConnections) {
      if (!transport.isConnected()) this.httpConnections.delete(clientId);
    }
  }

  private consumeHttpRequestAllowance(req: IncomingMessage): boolean {
    const options = this.httpRateLimitOptions();
    if (!options) return true;
    const now = Date.now();
    const key = options.key?.(req) || req.socket.remoteAddress || 'unknown';
    const current = this.requestRateLimits.get(key);
    if (!current || now - current.startedAt >= options.windowMs) {
      this.requestRateLimits.set(key, { startedAt: now, count: 1 });
      this.pruneRequestRateLimits(now, options.windowMs);
      return true;
    }
    if (current.count >= options.maxRequestsPerIp) {
      return false;
    }
    current.count++;
    return true;
  }

  private httpRateLimitOptions(): Required<Omit<HttpRateLimitOptions, 'key'>> & {
    key?: HttpRateLimitOptions['key'];
  } | null {
    if (this.options.httpRateLimit === false) return null;
    return {
      windowMs: this.options.httpRateLimit?.windowMs ?? 60_000,
      maxRequestsPerIp: this.options.httpRateLimit?.maxRequestsPerIp ?? 600,
      key: this.options.httpRateLimit?.key,
    };
  }

  private pruneRequestRateLimits(now: number, windowMs: number): void {
    if (this.requestRateLimits.size < 1000) return;
    for (const [key, entry] of this.requestRateLimits) {
      if (now - entry.startedAt >= windowMs) this.requestRateLimits.delete(key);
    }
  }

  private respond(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ): void {
    const responseHeaders = {
      ...this.corsHeaders(req.headers.origin),
      ...headers,
    };
    if (status !== 204 && body !== undefined && !responseHeaders['Content-Type']) {
      responseHeaders['Content-Type'] = 'application/json';
    }
    res.writeHead(status, responseHeaders);
    if (status === 204 || body === undefined) {
      res.end();
    } else {
      res.end(JSON.stringify(body));
    }
  }

  private corsHeaders(origin?: string): Record<string, string> {
    if (this.options.cors === false) return {};
    const cors = this.options.cors || {};
    const configured = cors.origin ?? '*';
    let responseOrigin: string | undefined;
    if (configured === '*') {
      responseOrigin = '*';
    } else if (origin && this.isOriginAllowed(origin)) {
      responseOrigin = origin;
    }
    if (!responseOrigin) return {};
    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': responseOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': (
        cors.allowedHeaders || ['Content-Type', 'X-Client-ID', 'Authorization']
      ).join(', '),
    };
    if (responseOrigin !== '*') headers.Vary = 'Origin';
    if (cors.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
    return headers;
  }

  private isOriginAllowed(origin?: string): boolean {
    if (!origin || this.options.cors === false) return true;
    const configured = this.options.cors?.origin ?? '*';
    if (configured === '*') return true;
    if (typeof configured === 'function') return configured(origin);
    if (Array.isArray(configured)) return configured.includes(origin);
    return configured === origin;
  }

  private requestUrl(req: IncomingMessage): URL {
    return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  }

  private toWebHeaders(rawHeaders: IncomingHttpHeaders): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(rawHeaders)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }
    return headers;
  }

  private rejectUpgrade(socket: Duplex, status: number, message: string): void {
    if (!socket.destroyed) {
      socket.end(
        `HTTP/1.1 ${status} ${message}\r\n`
        + 'Connection: close\r\n'
        + 'Content-Type: text/plain\r\n'
        + `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`
        + message,
      );
    }
  }

  private validateOptions(): void {
    for (const [name, value] of [
      ['maxRequestBodyBytes', this.options.maxRequestBodyBytes],
      ['longPollTimeoutMs', this.options.longPollTimeoutMs],
      ['maxPendingHandshakes', this.options.maxPendingHandshakes],
    ] as const) {
      if (!Number.isInteger(value) || (value as number) <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
    }
    const rateLimit = this.httpRateLimitOptions();
    if (
      rateLimit
      && (
        !Number.isInteger(rateLimit.windowMs)
        || rateLimit.windowMs <= 0
        || !Number.isInteger(rateLimit.maxRequestsPerIp)
        || rateLimit.maxRequestsPerIp <= 0
      )
    ) {
      throw new Error('HTTP rate limits must be positive integers');
    }
    if (
      this.options.cors !== false
      && this.options.cors?.credentials
      && (this.options.cors.origin ?? '*') === '*'
    ) {
      throw new Error('CORS credentials require an explicit origin');
    }
    if (this.options.webTransport) {
      if (
        this.options.webTransport.hostname !== undefined
        && !this.options.webTransport.hostname
      ) {
        throw new Error('webTransport.hostname must not be empty');
      }
      if (
        this.options.webTransport.secret !== undefined
        && !this.options.webTransport.secret
      ) {
        throw new Error('webTransport.secret must not be empty');
      }
      for (const [name, value] of Object.entries(this.options.webTransport)) {
        if (
          name !== 'hostname'
          && name !== 'publicUrl'
          && name !== 'cert'
          && name !== 'privateKey'
          && name !== 'secret'
          && value !== undefined
          && (!Number.isInteger(value) || (value as number) <= 0)
        ) {
          throw new Error(`webTransport.${name} must be a positive integer`);
        }
        if (name === 'port' && (value as number) > 65_535) {
          throw new Error('webTransport.port must be at most 65535');
        }
      }
      if (
        this.options.webTransport.publicUrl
        && new URL(this.options.webTransport.publicUrl).protocol !== 'https:'
      ) {
        throw new Error('webTransport.publicUrl must use https');
      }
      if (
        this.options.webTransport.maxBufferedBytes !== undefined
        && this.options.webTransport.maxBufferedBytes < (
          this.options.webTransport.maxFrameBytes
          ?? this.options.maxRequestBodyBytes
          ?? 1024 * 1024
        )
      ) {
        throw new Error(
          'webTransport.maxBufferedBytes must be at least as large as '
          + 'webTransport.maxFrameBytes',
        );
      }
    }
  }

  private authorizeWebTransport(
    url: URL,
    headers: Record<string, string>,
  ): AuthorizedWebTransportSession | null {
    const origin = headers.origin;
    if (!this.isOriginAllowed(origin)) return null;
    const reconnectSecret = url.searchParams.get('secret');
    const clientId = url.searchParams.get('clientId');
    const hadHttpConnection = Boolean(
      clientId
      && (
        this.httpConnections.has(clientId)
        || this.httpConnectionPromises.has(clientId)
      ),
    );
    if (!this.router?.canAcceptConnection(reconnectSecret)) return null;
    const entry = this.consumeHttpUpgradeToken(
      clientId,
      url.searchParams.get('upgradeToken'),
      reconnectSecret,
    );
    if (!entry || !reconnectSecret) return null;
    return {
      reconnectSecret: reconnectSecret as ConnectionSecret,
      identity: entry.identity,
      allowActiveReplacement: hadHttpConnection,
    };
  }

  private async handleWebTransportConnection(
    session: import('../../core').WebTransportSessionLike,
    authorization: AuthorizedWebTransportSession,
  ): Promise<void> {
    if (!this.router) return;
    const configured = this.options.webTransport || {};
    const transport = new WebTransportSessionTransport(session, {
      role: 'server',
      maxFrameBytes: configured.maxFrameBytes ?? this.options.maxRequestBodyBytes,
      maxBufferedBytes: configured.maxBufferedBytes,
      streamTimeoutMs: configured.streamTimeoutMs,
    });
    const connection = await this.router.handleNewConnection(
      transport,
      authorization.reconnectSecret,
      authorization.allowActiveReplacement,
      authorization.identity,
    );
    if (!transport.isConnected()) {
      await connection.connect();
    }
  }
}

class RequestBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds the ${maxBytes} byte limit`);
  }
}

import { ConnectionSecret } from '@neorest/core';
import { Router, ServerAdapter } from '@neorest/router-core';
import { HttpStrategy } from '../strategies/HttpStrategy';
// Removed static import of WebSocketStrategy to avoid pulling 'ws' at module load
import { createServer as createHttpServer, Server as HttpServer } from 'http';
import { createServer as createHttpsServer, Server as HttpsServer } from 'https';
// Removed static import of WebSocketServer from 'ws' to make it optional at runtime
import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';

/**
 * Node server adapter options
 */
export interface NodeServerAdapterOptions {
  port?: number;
  hostname?: string;
  expressApp?: any; // This would be Express app
  ssl?: {
    key: string;
    cert: string;
  };
  /**
   * When true, do not setup WebSocket server or upgrade handling.
   */
  disableWebSocket?: boolean;
  /**
   * When true, do not expose routes over plain HTTP (/.neorest transport still works).
   */
  disableHttpRoutes?: boolean;
}

/**
 * Node.js server adapter
 */
export class NodeServerAdapter implements ServerAdapter {
  private options: NodeServerAdapterOptions;
  private router?: Router;
  private server: HttpServer | HttpsServer | null = null;
  private wsServer: any | null = null; // WebSocketServer is optional
  private httpConnections: Map<string, HttpStrategy> = new Map();

  /**
   * Constructor
   * @param options - Adapter options
   */
  constructor(options?: NodeServerAdapterOptions) {
    this.options = {
      port: 8080,
      hostname: 'localhost',
      ...options
    };
  }

  /**
   * Initialize the server
   * @param router - The router instance
   */
  async initialize(router: Router): Promise<void> {
    this.router = router;

    // Create HTTP/HTTPS server
    if (this.options.ssl?.key && this.options.ssl?.cert) {
      this.server = createHttpsServer({ key: this.options.ssl.key, cert: this.options.ssl.cert }, (req, res) => this.handleHttpRequest(req, res));
    } else {
      this.server = createHttpServer((req, res) => this.handleHttpRequest(req, res));
    }

    // Try to set up WebSocket server bound to the HTTP server, if 'ws' is available and not disabled
    if (!this.options.disableWebSocket) {
      try {
        const { WebSocketServer } = await import('ws');
        this.wsServer = new WebSocketServer({ noServer: true });

        this.server.on('upgrade', (request: IncomingMessage, socket, head) => {
          this.wsServer!.handleUpgrade(request, socket as any, head, async (ws: any) => {
            await this.handleWebSocketConnection(ws, request);
          });
        });
      } catch (err) {
        // 'ws' not installed; skip WebSocket support
        this.wsServer = null;
      }
    } else {
      this.wsServer = null;
    }

    console.log(`Initializing Node.js server on ${this.options.hostname}:${this.options.port}`);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }
    if (!this.server) {
      throw new Error('HTTP server not initialized');
    }

    await new Promise<void>((resolve) => {
      this.server!.listen(this.options.port, this.options.hostname, () => resolve());
    });

    console.log(`Server listening on http://${this.options.hostname}:${this.options.port}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Close all HTTP connections
    for (const strategy of this.httpConnections.values()) {
      strategy.disconnect();
    }
    this.httpConnections.clear();
    
    if (this.wsServer) {
      await new Promise<void>((resolve) => {
        this.wsServer!.clients.forEach((client: any) => client.terminate());
        this.wsServer!.close(() => resolve());
      });
      this.wsServer = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }

    console.log('Server stopped');
  }

  /**
   * Handle a WebSocket connection
   * @param socket - The WebSocket connection
   * @param request - The HTTP request
   */
  private async handleWebSocketConnection(socket: any, request: IncomingMessage): Promise<void> {
    if (!this.router) return;

    // Defer loading the WebSocketStrategy to avoid importing 'ws' unless needed
    const { WebSocketStrategy } = await import('../strategies/WebSocketStrategy');

    // Get reconnect secret from URL
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const reconnectSecret = url.searchParams.get('secret');
    
    // Create strategy and add connection
    const strategy = new WebSocketStrategy(socket as any);
    this.router.handleNewConnection(strategy as any, reconnectSecret as ConnectionSecret);
  }

  /**
   * Handle an HTTP request
   * @param req - The HTTP request
   * @param res - The HTTP response
   */
  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.router) {
      res.statusCode = 500;
      res.end('Router not initialized');
      return;
    }

    // Parse the URL and query parameters
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Client-ID, Authorization',
      });
      res.end();
      return;
    }

    // Transport endpoints are under /.neorest
    if (url.pathname === '/.neorest') {
      const clientId = url.searchParams.get('clientId');
      const isPoll = url.searchParams.get('poll') === 'true';
      const reconnectSecret = url.searchParams.get('secret');

      // If no client ID, generate one and send it back
      if (!clientId) {
        const newClientId = randomUUID();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ clientId: newClientId }));
        return;
      }

      // Create or retrieve HTTP strategy for this client
      let strategy = this.httpConnections.get(clientId);
      if (!strategy) {
        console.log(`New HTTP client connection: ${clientId}`);
        strategy = new HttpStrategy(clientId);
        this.httpConnections.set(clientId, strategy);
        this.router.handleNewConnection(strategy, reconnectSecret as ConnectionSecret);
      }

      // Handle long polling
      if (isPoll) {
        const messages = strategy.getQueuedMessages();
        if (messages.length > 0) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(messages));
        } else {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
          res.end();
        }
        return;
      }

      // Handle message POST
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const message = JSON.parse(body);
            strategy!.processMessage(message);
            await new Promise(resolve => setTimeout(resolve, 50));
            const responseMessages = strategy!.getQueuedMessages();
            if (responseMessages.length > 0) {
              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify(responseMessages));
            } else {
              res.writeHead(202, { 'Access-Control-Allow-Origin': '*' });
              res.end();
            }
          } catch (error) {
            console.error('Error processing HTTP message:', error);
            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: 'Invalid message format' }));
          }
        });
        return;
      }

      // Method not allowed for transport endpoint
      res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Regular HTTP route dispatch
    const method = (req.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'DELETE';

    // Parse body if needed
    const collectBody = async () => new Promise<string>((resolve) => {
      if (req.method === 'POST' || req.method === 'DELETE') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
      } else {
        resolve('');
      }
    });

    const rawBody = await collectBody();

    let data: any = null;
    if (method === 'GET') {
      // Use query params as data for GET
      data = Object.fromEntries(url.searchParams.entries());
    } else if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
    }

    const { status, body, contentType } = await this.router.executeHttpRoute(method, url.pathname, data, req.headers as any);
    res.writeHead(status, { 'Content-Type': contentType || 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  }
}
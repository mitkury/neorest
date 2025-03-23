import { ConnectionSecret } from '@neorest/core';
import { Router, ServerAdapter } from '@neorest/router-core';
import { WebSocketStrategy } from '@neorest/router-core';
import { HttpStrategy } from '../strategies/HttpStrategy';

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
}

/**
 * Node.js server adapter
 */
export class NodeServerAdapter implements ServerAdapter {
  private options: NodeServerAdapterOptions;
  private router?: Router;
  private server: any = null; // This would be http.Server or https.Server
  private wsServer: any = null; // This would be WebSocket.Server
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
    
    // In a real implementation, this would:
    // 1. Create an HTTP/HTTPS server based on options
    // 2. Set up WebSocket server
    // 3. Set up route handlers for HTTP requests
    
    console.log(`Initializing Node.js server on ${this.options.hostname}:${this.options.port}`);
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }
    
    // In a real implementation, this would:
    // 1. Start listening on the configured port
    // 2. Set up error handling
    
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
    
    // In a real implementation, this would:
    // 1. Close the HTTP server
    // 2. Close the WebSocket server
    // 3. Clean up any resources
    
    console.log('Server stopped');
  }

  /**
   * Handle a WebSocket connection
   * @param socket - The WebSocket connection
   * @param request - The HTTP request
   */
  private handleWebSocketConnection(socket: WebSocket, request: any): void {
    if (!this.router) return;
    
    // Get reconnect secret from URL
    const url = new URL(request.url, `http://${request.headers.host}`);
    const reconnectSecret = url.searchParams.get('secret');
    
    // Create strategy and add connection
    const strategy = new WebSocketStrategy(socket);
    this.router.handleNewConnection(strategy, reconnectSecret as ConnectionSecret);
  }

  /**
   * Handle an HTTP request
   * @param req - The HTTP request
   * @param res - The HTTP response
   */
  private async handleHttpRequest(req: any, res: any): Promise<void> {
    if (!this.router) {
      res.statusCode = 500;
      res.end('Router not initialized');
      return;
    }
    
    // Parse the URL and query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientId = url.searchParams.get('clientId');
    const isPoll = url.searchParams.get('poll') === 'true';
    const reconnectSecret = url.searchParams.get('secret');
    
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Client-ID',
      });
      res.end();
      return;
    }
    
    // If no client ID, generate one and send it back
    if (!clientId) {
      const newClientId = crypto.randomUUID();
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
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*'
        });
        res.end();
      }
      return;
    }
    
    // Handle message POST
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const message = JSON.parse(body);
          strategy!.processMessage(message);
          
          // Wait briefly for a response
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Return any immediate response
          const responseMessages = strategy!.getQueuedMessages();
          if (responseMessages.length > 0) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(responseMessages[0]));
          } else {
            res.writeHead(202, {
              'Access-Control-Allow-Origin': '*'
            });
            res.end();
          }
        } catch (error) {
          console.error('Error processing HTTP message:', error);
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ error: 'Invalid message format' }));
        }
      });
      return;
    }
    
    // Default response
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    res.end('Neorest server');
  }
}
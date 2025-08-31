import { ConnectionSecret } from '../../core';
import { Router, ServerAdapter } from '../../core';
import { WebSocketStrategy } from '../../core';
import { HttpStrategy } from '../strategies/HttpStrategy';

/**
 * Deno server adapter options
 */
export interface DenoServerAdapterOptions {
  port?: number;
  hostname?: string;
  certFile?: string;
  keyFile?: string;
}

/**
 * Deno server adapter
 */
export class DenoServerAdapter implements ServerAdapter {
  private options: DenoServerAdapterOptions;
  private router?: Router;
  private server: Deno.Server | null = null;
  private httpConnections: Map<string, HttpStrategy> = new Map();
  private sessionCleanupInterval: number | null = null;

  /**
   * Constructor
   * @param options - Adapter options
   */
  constructor(options?: DenoServerAdapterOptions) {
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
    
    // Set up periodic cleanup of inactive HTTP connections
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupInactiveHttpConnections();
    }, 60000) as unknown as number;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (!this.router) {
      throw new Error('Router not initialized');
    }

    // Create a controller for handling cleanup
    const controller = new AbortController();
    const { signal } = controller;

    // Set up a handler for HTTP requests
    const handler = async (request: Request, connInfo: Deno.ServeHandlerInfo): Promise<Response> => {
      // Check if it's a WebSocket upgrade request
      if (request.headers.get("upgrade") === "websocket") {
        try {
          // Create WebSocket connection
          const { socket, response } = Deno.upgradeWebSocket(request);
          
          // Handle WebSocket connection
          this.handleWebSocketConnection(socket, request);
          
          return response;
        } catch (error) {
          console.error("WebSocket upgrade error:", error);
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
      }
      
      // Handle regular HTTP request
      return this.handleHttpRequest(request);
    };

    // Create the server
    const serverOptions: Deno.ServeOptions = {
      port: this.options.port || 8080,
      hostname: this.options.hostname || 'localhost',
      signal,
    };

    // Add TLS options if provided
    if (this.options.certFile && this.options.keyFile) {
      const cert = await Deno.readTextFile(this.options.certFile);
      const key = await Deno.readTextFile(this.options.keyFile);
      Object.assign(serverOptions, { cert, key });
    }

    this.server = Deno.serve(serverOptions, handler);
    
    console.log(`Server set up on ${this.options.hostname}:${this.options.port}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Stop the HTTP session cleanup interval
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
    
    // Close all HTTP connections
    for (const strategy of this.httpConnections.values()) {
      strategy.disconnect();
    }
    this.httpConnections.clear();
    
    // Shut down the server
    if (this.server) {
      this.server.shutdown();
      this.server = null;
    }
    
    console.log('Server stopped');
  }

  /**
   * Clean up inactive HTTP connections
   */
  private cleanupInactiveHttpConnections(): void {
    const inactiveIds: string[] = [];
    
    for (const [id, strategy] of this.httpConnections.entries()) {
      if (!strategy.isConnected()) {
        inactiveIds.push(id);
      }
    }
    
    for (const id of inactiveIds) {
      this.httpConnections.delete(id);
      console.log(`Cleaned up inactive HTTP connection: ${id}`);
    }
  }

  /**
   * Handle a WebSocket connection
   * @param socket - The WebSocket connection
   * @param request - The HTTP request
   */
  private handleWebSocketConnection(socket: WebSocket, request: Request): void {
    if (!this.router) return;
    
    console.log("New WebSocket connection established");
    
    // Get reconnect secret from URL if present
    const url = new URL(request.url);
    const reconnectSecret = url.searchParams.get('secret');
    
    // Create WebSocketStrategy and add connection
    const strategy = new WebSocketStrategy(socket);
    this.router.handleNewConnection(strategy, reconnectSecret as ConnectionSecret);
  }

  /**
   * Handle an HTTP request
   * @param request - The HTTP request
   * @returns The HTTP response
   */
  private async handleHttpRequest(request: Request): Promise<Response> {
    if (!this.router) {
      return new Response('Router not initialized', { status: 500 });
    }
    
    console.log(`HTTP ${request.method} request: ${request.url}`);
    
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    const isPoll = url.searchParams.get('poll') === 'true';
    const reconnectSecret = url.searchParams.get('secret');
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Client-ID',
        }
      });
    }
    
    // If no client ID, generate one and send it back
    if (!clientId) {
      const newClientId = crypto.randomUUID();
      return new Response(JSON.stringify({ clientId: newClientId }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Create or retrieve HTTP strategy for this client
    let strategy = this.httpConnections.get(clientId);
    
    if (!strategy) {
      console.log(`New HTTP client connection: ${clientId}`);
      strategy = new HttpStrategy(clientId);
      this.httpConnections.set(clientId, strategy);
      this.router.handleNewConnection(strategy, reconnectSecret as ConnectionSecret);
    }
    
    // Handle long polling - return any queued messages
    if (isPoll) {
      const messages = strategy.getQueuedMessages();
      if (messages.length > 0) {
        return new Response(JSON.stringify(messages), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else {
        // No messages, return 204 No Content
        return new Response(null, { 
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }
    }
    
    // Handle regular HTTP requests (POST for messages, GET for API endpoints)
    if (request.method === 'POST') {
      try {
        // Parse the message and process it
        const message = await request.json();
        strategy.processMessage(message);
        
        // Wait briefly for a response - give the handlers time to process
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Return any immediate response messages
        const responseMessages = strategy.getQueuedMessages();
        if (responseMessages.length > 0) {
          return new Response(JSON.stringify(responseMessages[0]), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        } else {
          // No immediate response
          return new Response(null, { 
            status: 202, // Accepted
            headers: { 'Access-Control-Allow-Origin': '*' }
          });
        }
      } catch (error) {
        console.error('Error processing HTTP message:', error);
        return new Response(JSON.stringify({ error: 'Invalid message format' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // Default response for other request types
    return new Response('Neorest server', { 
      status: 200,
      headers: { 
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
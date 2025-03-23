import { 
  new_MsgWrapper,
  new_MsgGenericError,
  new_MsgResponseOK,
  new_MsgRoute,
  ROUTE_MESSAGE
} from '@neorest/core';
import { assertEquals, assertExists } from "https://deno.land/std@0.203.0/testing/asserts.ts";

/**
 * Basic WebSocket server for testing
 */
class TestServer {
  private port: number;
  private server: any = null;
  private connections: Set<WebSocket> = new Set();
  
  constructor(port = 8081) {
    this.port = port;
  }
  
  async start(): Promise<void> {
    if (this.server) return;
    
    // Create a controller for handling cleanup
    const controller = new AbortController();
    const { signal } = controller;
    
    // Set up a handler for HTTP requests
    const handler = async (request: Request): Promise<Response> => {
      // Check if it's a WebSocket upgrade request
      if (request.headers.get("upgrade") === "websocket") {
        try {
          // Create WebSocket connection
          const { socket, response } = Deno.upgradeWebSocket(request);
          
          // Set up message handler
          socket.onmessage = (event) => {
            try {
              const parsedMsg = JSON.parse(event.data);
              console.log("Server received message:", parsedMsg);
              
              // Process the message based on type
              if (parsedMsg.msg && parsedMsg.msg.type === ROUTE_MESSAGE) {
                const routeMsg = parsedMsg.msg;
                const responseData = {
                  route: routeMsg.route,
                  method: routeMsg.verb,
                  received: routeMsg.data
                };
                
                const response = new_MsgResponseOK(parsedMsg.id, responseData);
                socket.send(JSON.stringify(response));
              } else {
                // Default echo response
                const response = new_MsgResponseOK(parsedMsg.id, { echo: parsedMsg.msg });
                socket.send(JSON.stringify(response));
              }
            } catch (error) {
              console.error("Error handling message:", error);
              try {
                const parsedMsg = JSON.parse(event.data);
                if (typeof parsedMsg.id === 'number' || typeof parsedMsg.id === 'string') {
                  const errorResponse = new_MsgGenericError(parsedMsg.id, "Error processing message");
                  socket.send(JSON.stringify(errorResponse));
                }
              } catch {
                console.error("Could not parse message to send error response");
              }
            }
          };
          
          // Set up close handler
          socket.onclose = () => {
            this.connections.delete(socket);
            console.log("Client disconnected");
          };
          
          // Add to connections
          this.connections.add(socket);
          console.log("Client connected");
          
          return response;
        } catch (error) {
          console.error("WebSocket upgrade error:", error);
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
      }
      
      // Handle regular HTTP request
      return new Response('Test server running', { 
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    };
    
    // Create the server
    this.server = Deno.serve({ 
      port: this.port, 
      hostname: 'localhost', 
      signal 
    }, handler);
    
    console.log(`Test server running on http://localhost:${this.port}`);
  }
  
  stop(): void {
    if (this.server) {
      this.server.shutdown();
      this.server = null;
      console.log("Server stopped");
    }
  }
}

/**
 * Basic WebSocket client for testing
 */
class TestClient {
  private socket: WebSocket | null = null;
  private connected = false;
  private callbacks = new Map();
  
  async connect(url: string): Promise<void> {
    // Connect to server
    this.socket = new WebSocket(url);
    
    // Set up message handler
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.target !== undefined && this.callbacks.has(data.target)) {
          const callback = this.callbacks.get(data.target);
          callback(data);
          this.callbacks.delete(data.target);
        }
      } catch (error) {
        console.error("Error handling response:", error);
      }
    };
    
    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Socket not initialized"));
        return;
      }
      
      this.socket.onopen = () => {
        this.connected = true;
        console.log("Connected to server");
        resolve();
      };
      
      this.socket.onerror = (event) => {
        console.error("WebSocket error:", event);
        reject(new Error("Failed to connect"));
      };
    });
  }
  
  async sendAndReceive(message: string | object): Promise<any> {
    if (!this.socket || !this.connected) {
      throw new Error("Not connected");
    }
    
    // Create message wrapper
    const msgId = crypto.randomUUID();
    const wrapper = new_MsgWrapper(msgId, message);
    
    // Wait for response
    const response = await new Promise<any>((resolve) => {
      // Register callback
      this.callbacks.set(msgId, resolve);
      
      // Send message
      this.socket!.send(JSON.stringify(wrapper));
    });
    
    return response;
  }
  
  async sendToRoute(route: string, data: any): Promise<any> {
    const routeMsg = new_MsgRoute(route, "GET", data);
    return this.sendAndReceive(routeMsg);
  }
  
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.connected = false;
      console.log("Disconnected from server");
    }
  }
  
  isConnected(): boolean {
    return this.connected;
  }
}

// Integration tests
Deno.test({
  name: "Basic Client-Server Communication Test",
  async fn() {
    // Start server
    const server = new TestServer(8081);
    await server.start();
    
    try {
      // Create and connect client
      const client = new TestClient();
      await client.connect("ws://localhost:8081");
      
      // Send a message and wait for response
      const message = "Hello, server!";
      const response = await client.sendAndReceive(message);
      console.log("Response:", response);
      
      // Verify response
      assertEquals(response.type, "res");
      assertEquals(response.status, 200);
      assertEquals(response.data.echo, message);
      
      // Disconnect client
      client.disconnect();
    } finally {
      // Stop server
      server.stop();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false
});

Deno.test({
  name: "Route Message Test",
  async fn() {
    // Start server
    const server = new TestServer(8082);
    await server.start();
    
    try {
      // Create and connect client
      const client = new TestClient();
      await client.connect("ws://localhost:8082");
      
      // Send a message to a route
      const result = await client.sendToRoute("/test/route", { value: 42 });
      console.log("Route response:", result);
      
      // Verify response
      assertEquals(result.type, "res");
      assertEquals(result.status, 200);
      assertEquals(result.data.route, "/test/route");
      assertEquals(result.data.method, "GET");
      assertEquals(result.data.received.value, 42);
      
      // Disconnect client
      client.disconnect();
    } finally {
      // Stop server
      server.stop();
    }
  },
  sanitizeOps: false,
  sanitizeResources: false
});

// Run tests
if (import.meta.main) {
  Deno.test("Run core package integration tests", async (t) => {
    await t.step({
      name: "Basic client-server communication",
      fn: async () => {
        // Start server
        const server = new TestServer(8083);
        await server.start();
        
        try {
          // Create and connect client
          const client = new TestClient();
          await client.connect("ws://localhost:8083");
          
          // Send a message to a route and wait for response
          const result = await client.sendToRoute("/api/test", { hello: "world" });
          console.log("Route response:", result);
          
          // Verify response contains expected data
          assertEquals(result.data.route, "/api/test");
          assertEquals(result.data.received.hello, "world");
          
          // Disconnect client
          client.disconnect();
        } finally {
          // Stop server
          server.stop();
        }
      },
      sanitizeOps: false,
      sanitizeResources: false
    });
  });
}
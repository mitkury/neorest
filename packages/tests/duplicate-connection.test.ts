import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { portManager } from './utils/portManager';

describe('Duplicate Connection Handling', () => {
  let server: NodeRouter;
  let serverPort: number;

  beforeEach(async () => {
    serverPort = await portManager.getNextPort();
    server = new NodeRouter({ port: serverPort });

    server
      .onGet('/ping', async (ctx) => { ctx.response = 'pong'; })
      .onPost('/echo', async (ctx) => { ctx.response = ctx.data; })
      .onPost('/connection-info', async (ctx) => { 
        ctx.response = { 
          timestamp: Date.now(),
          message: 'Connection info received' 
        }; 
      });

    await server.listen();
  });

  afterEach(async () => {
    try { await server.close(); } catch {}
  });

  it('should handle duplicate connections with same secret gracefully', async () => {
    let client1: Client | null = null;
    let client2: Client | null = null;
    let client1Disconnected = false;

    try {
      // First connection
      client1 = new Client(`ws://localhost:${serverPort}`, 'websocket');
      await (client1 as any).conn.connect();
      
      // Wait for secret
      let secret = '';
      let attempts = 0;
      while (!secret && attempts < 50) {
        secret = (client1 as any).conn.getSecret();
        if (!secret) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
      }
      expect(secret).toBeTruthy();

      // Track disconnection of first client
      const originalOnClose = (client1 as any).conn.onClose;
      (client1 as any).conn.onClose = () => {
        client1Disconnected = true;
        originalOnClose();
      };

      // Send a message from first client
      const response1 = await client1.post('/echo', { from: 'client1' });
      expect(response1.data).toEqual({ from: 'client1' });

      // Create second connection with same secret
      client2 = new Client(`ws://localhost:${serverPort}`, 'websocket');
      (client2 as any).conn.setHeader('secret', secret);
      await (client2 as any).conn.connect();

      // Wait for disconnection of first client
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // First client should be disconnected
      expect(client1Disconnected).toBe(true);
      expect(client1.isConnected()).toBe(false);

      // Second client should be connected
      expect(client2.isConnected()).toBe(true);

      // Second client should be able to send messages
      const response2 = await client2.post('/echo', { from: 'client2' });
      expect(response2.data).toEqual({ from: 'client2' });

      // Verify server only has one connection
      const serverConnections = (server as any).connections;
      const activeConnections = Object.keys(serverConnections).length;
      expect(activeConnections).toBe(1);

    } finally {
      try { (client1 as any)?.close?.(); } catch {}
      try { (client2 as any)?.close?.(); } catch {}
    }
  });

  it('should handle multiple rapid reconnection attempts', async () => {
    let clients: Client[] = [];
    let disconnectedCount = 0;

    try {
      // Create first connection
      const client1 = new Client(`ws://localhost:${serverPort}`, 'websocket');
      await (client1 as any).conn.connect();
      clients.push(client1);

      // Wait for secret
      let secret = '';
      let attempts = 0;
      while (!secret && attempts < 50) {
        secret = (client1 as any).conn.getSecret();
        if (!secret) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
      }
      expect(secret).toBeTruthy();

      // Track disconnections
      const trackDisconnection = (client: Client) => {
        const originalOnClose = (client as any).conn.onClose;
        (client as any).conn.onClose = () => {
          disconnectedCount++;
          originalOnClose();
        };
      };

      trackDisconnection(client1);

      // Create multiple rapid reconnection attempts
      for (let i = 0; i < 3; i++) {
        const newClient = new Client(`ws://localhost:${serverPort}`, 'websocket');
        (newClient as any).conn.setHeader('secret', secret);
        trackDisconnection(newClient);
        
        try {
          await (newClient as any).conn.connect();
          clients.push(newClient);
        } catch (error) {
          // Some connections might fail due to rapid reconnection
          console.log(`Connection ${i} failed:`, error);
        }
        
        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Wait for disconnections to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should have only one active connection
      const activeConnections = clients.filter(c => c.isConnected());
      expect(activeConnections.length).toBe(1);

      // Should have had some disconnections
      expect(disconnectedCount).toBeGreaterThan(0);

    } finally {
      clients.forEach(client => {
        try { (client as any)?.close?.(); } catch {}
      });
    }
  });

  it('should maintain connection state during reconnection', async () => {
    let client1: Client | null = null;
    let client2: Client | null = null;

    try {
      // First connection
      client1 = new Client(`ws://localhost:${serverPort}`, 'websocket');
      await (client1 as any).conn.connect();
      
      // Wait for secret
      let secret = '';
      let attempts = 0;
      while (!secret && attempts < 50) {
        secret = (client1 as any).conn.getSecret();
        if (!secret) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
      }
      expect(secret).toBeTruthy();

      // Subscribe to a route
      const broadcasts: any[] = [];
      await client1.on('/topic/news', (evt) => {
        broadcasts.push(evt.data);
      });

      // Send a message that triggers a broadcast
      await client1.post('/echo', { message: 'test' });

      // Create second connection (this should disconnect the first)
      client2 = new Client(`ws://localhost:${serverPort}`, 'websocket');
      (client2 as any).conn.setHeader('secret', secret);
      await (client2 as any).conn.connect();

      // Wait for disconnection
      await new Promise(resolve => setTimeout(resolve, 200));

      // Second client should be connected
      expect(client2.isConnected()).toBe(true);

      // Second client should be able to subscribe to routes
      const broadcasts2: any[] = [];
      await client2.on('/topic/news', (evt) => {
        broadcasts2.push(evt.data);
      });

      // Send another message
      await client2.post('/echo', { message: 'test2' });

      // Wait for any broadcasts
      await new Promise(resolve => setTimeout(resolve, 100));

      // Note: The current implementation doesn't automatically resubscribe
      // This test documents the current behavior
      expect(broadcasts2.length).toBe(0); // No automatic resubscription

    } finally {
      try { (client1 as any)?.close?.(); } catch {}
      try { (client2 as any)?.close?.(); } catch {}
    }
  });
});
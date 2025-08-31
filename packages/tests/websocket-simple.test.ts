import { describe, it, expect } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';
import { portManager } from './utils/portManager';

describe('WebSocket Simple Connection Test', () => {
  it('establishes basic WebSocket connection and sends/receives messages', async () => {
    const serverPort = await portManager.getNextPort();
    const router = new NodeRouter({ port: serverPort });

    // Simple echo endpoint
    router.onPost('/echo', async (ctx) => {
      ctx.response = ctx.data;
    });

    await router.listen();

    try {
      // Create client
      const client = new Client(`ws://localhost:${serverPort}`, 'websocket');
      
      // Connect
      await (client as any).conn.connect();
      
      // Test basic communication
      const testData = { message: 'hello', timestamp: Date.now() };
      const response = await client.post('/echo', testData);
      
      expect(response.data).toEqual(testData);
      
      // Cleanup
      (client as any).close();
    } finally {
      await router.close();
    }
  });
});
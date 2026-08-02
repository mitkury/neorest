import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, ClientConnection } from 'neorest';
import { msg_ConnDataSet, type ClientTransport, type MsgWrapper } from 'neorest/core';
import { NodeRouter } from 'neorest/node';
import { portManager } from './utils/portManager';

interface InternalClientConnection {
  getSecret(): string;
  post(
    message: unknown,
    callback: (response: { status?: number; error?: string }) => void,
  ): void;
  transport: {
    getUpgradeInfo(): { clientId: string; token: string };
  };
}

function connectionOf(client: Client): InternalClientConnection {
  return (client as unknown as { conn: InternalClientConnection }).conn;
}

describe('security boundaries', () => {
  let server: NodeRouter;
  let port: number;

  beforeAll(async () => {
    port = await portManager.getNextPort();
    server = new NodeRouter({ port });
    server
      .onGet('/whoami', (context) => {
        context.response = {
          transport: context.sender.getTransport().constructor.name,
        };
      })
      .onGet('/echo', (context) => {
        context.response = { ok: true };
      });
    await server.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it('does not let a stolen reconnect secret replace an active session', async () => {
    const victim = new Client(`http://localhost:${port}`, 'http');
    const attackerHttp = new Client(`http://localhost:${port}`, 'http');
    let attacker: Client | undefined;
    let tokenSwap: Client | undefined;
    try {
      await victim.connect();
      expect((await victim.get<{ transport: string }>('/whoami')).data.transport).toBe(
        'HttpTransport',
      );
      const secret = connectionOf(victim).getSecret();
      expect(secret).toMatch(/^[a-f0-9]{64}$/);

      attacker = new Client(
        `ws://localhost:${port}?secret=${encodeURIComponent(secret)}`,
        'websocket',
        { reconnect: false },
      );
      await attacker.connect().catch(() => {});

      await attackerHttp.connect();
      const upgradeInfo = connectionOf(attackerHttp).transport.getUpgradeInfo();
      tokenSwap = new Client(
        `ws://localhost:${port}?secret=${encodeURIComponent(secret)}`
        + `&clientId=${encodeURIComponent(upgradeInfo.clientId)}`
        + `&upgradeToken=${encodeURIComponent(upgradeInfo.token)}`,
        'websocket',
        { reconnect: false },
      );
      await tokenSwap.connect().catch(() => {});

      const afterAttacks = await victim.get<{ transport: string }>('/whoami');
      expect(afterAttacks.error).toBeUndefined();
      expect(afterAttacks.data.transport).toBe('HttpTransport');
    } finally {
      victim.close();
      attackerHttp.close();
      attacker?.close();
      tokenSwap?.close();
    }
  });

  it('applies default CORS headers to transport and plain-route responses', async () => {
    const preflight = await fetch(`http://localhost:${port}/.neorest`, {
      method: 'OPTIONS',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');

    const route = await fetch(`http://localhost:${port}/echo`);
    expect(route.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('limits a client burst before every request reaches the transport', async () => {
    let connected = false;
    let sentMessages = 0;
    let onOpen = () => {};
    let onClose = () => {};
    const transport: ClientTransport = {
      async connect() {
        connected = true;
        onOpen();
      },
      disconnect() {
        if (!connected) return;
        connected = false;
        onClose();
      },
      send(_message: MsgWrapper) {
        sentMessages++;
      },
      onMessage() {},
      onOpen(callback) { onOpen = callback; },
      onClose(callback) { onClose = callback; },
      isConnected() { return connected; },
      setAuthentication() {},
      getConnectionInfo() {
        return {
          id: 'rate-limit-test',
          url: 'http://localhost',
          type: 'http',
          status: connected ? 'connected' : 'disconnected',
        };
      },
    };
    const connection = new ClientConnection(transport, { reconnect: false });
    try {
      await connection.connect();
      let rateLimitError = '';
      for (let index = 0; index < 101; index++) {
        connection.sendToRoute('/echo', 'GET', '', undefined, (response) => {
          if (response.error) rateLimitError = response.error;
        });
      }
      expect(sentMessages).toBe(100);
      expect(rateLimitError).toContain('Rate limit of 100 messages per second');
    } finally {
      connection.close();
    }
  });

  it('rejects client attempts to overwrite the server-managed reconnect secret', async () => {
    const client = new Client(`http://localhost:${port}`, 'http');
    try {
      await client.connect();
      const response = await new Promise<{ status?: number; error?: string }>((resolve) => {
        connectionOf(client).post(msg_ConnDataSet('secret', 'evil-secret'), resolve);
      });
      expect(response.status).toBe(403);
      expect(response.error).toContain('Secret is server-managed');
    } finally {
      client.close();
    }
  });
});

import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { Client } from 'neorest';
import { NodeRouter } from 'neorest/node';
import { WebSocket } from 'ws';
import { portManager } from './utils/portManager';

function setHandshakeCookie(client: Client, cookie: string): void {
  ((client as any).conn.transport as {
    setAuthentication(headers: Record<string, string>): void;
  }).setAuthentication({ Cookie: cookie });
}

describe('production server boundaries', () => {
  it('composes request and WebSocket handlers with an existing Node server', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter();
    router.onGet('/api/ping', (ctx) => {
      ctx.response = 'pong';
    });
    const handlers = await router.createHandlers();
    const host = createServer((req, res) => {
      void handlers.request(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('sveltekit');
        }
      });
    });
    host.on('upgrade', (req, socket, head) => {
      void handlers.upgrade(req, socket, head).then((handled) => {
        if (!handled) socket.destroy();
      });
    });
    await new Promise<void>((resolve) => host.listen(port, 'localhost', resolve));

    const client = new Client(`http://localhost:${port}`, 'auto', { timeout: 2000 });
    try {
      const appResponse = await fetch(`http://localhost:${port}/app`);
      expect(await appResponse.text()).toBe('sveltekit');

      const routeResponse = await fetch(`http://localhost:${port}/api/ping`);
      expect(await routeResponse.json()).toBe('pong');

      await client.connect();
      expect((await client.get('/api/ping')).data).toBe('pong');
    } finally {
      client.close();
      await router.close();
      await new Promise<void>((resolve) => host.close(() => resolve()));
    }
  });

  it('binds cookie-authenticated identity and rejects unauthorized subscriptions', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter({
      port,
      disableWebSocket: true,
      authenticateConnection: ({ headers }) => {
        const match = /(?:^|;\s*)session=([^;]+)/.exec(headers.get('cookie') || '');
        return match ? { id: match[1], role: 'member' } : null;
      },
    });
    let identityWasFrozen = false;
    router
      .onGet('/identity', (ctx) => {
        const identity = ctx.sender.getIdentity();
        identityWasFrozen = Object.isFrozen(identity);
        ctx.response = identity;
      })
      .onAuthorizeSubscription('/users/:userId', (conn, params) => {
        return conn.getIdentity()?.id === params.userId;
      })
      .onValidateBroadcast('/users/:userId', (conn, params) => {
        return conn.getIdentity()?.id === params.userId;
      });
    await router.start();

    const anonymous = await fetch(`http://localhost:${port}/.neorest`);
    expect(anonymous.status).toBe(401);

    const alice = new Client(`http://localhost:${port}`, 'http', { timeout: 1000 });
    setHandshakeCookie(alice, 'session=alice');
    try {
      await alice.connect();
      expect((await alice.get<{ id: string; role: string }>('/identity')).data).toEqual({
        id: 'alice',
        role: 'member',
      });
      await expect(alice.subscribe('/users/bob', () => {})).rejects.toThrow(
        'Subscription forbidden',
      );

      const events: unknown[] = [];
      await alice.subscribe('/users/alice', (event) => events.push(event.data));
      router.broadcastPost('/users/alice', { ok: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toEqual([{ ok: true }]);
      expect(identityWasFrozen).toBe(true);
    } finally {
      alice.close();
      await router.close();
    }
  });

  it('does not let a reconnect secret switch authenticated users', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter({
      port,
      authenticateConnection: ({ headers }) => {
        const match = /(?:^|;\s*)session=([^;]+)/.exec(headers.get('cookie') || '');
        return match ? { id: match[1] } : null;
      },
    });
    await router.start();

    const secret = 'a'.repeat(64);
    const alice = new WebSocket(
      `ws://localhost:${port}/.neorest?secret=${secret}`,
      { headers: { Cookie: 'session=alice' } },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        alice.once('open', resolve);
        alice.once('error', reject);
      });

      const bob = new WebSocket(
        `ws://localhost:${port}/.neorest?secret=${secret}`,
        { headers: { Cookie: 'session=bob' } },
      );
      const closeCode = await new Promise<number>((resolve, reject) => {
        bob.once('close', resolve);
        bob.once('error', reject);
      });
      expect(closeCode).toBe(1008);
      expect(alice.readyState).toBe(WebSocket.OPEN);
    } finally {
      alice.close();
      await router.close();
    }
  });

  it('holds an empty poll instead of short-polling every 100 ms', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter({
      port,
      disableWebSocket: true,
      longPollTimeoutMs: 150,
      httpRateLimit: false,
    });
    await router.start();
    try {
      const handshake = await fetch(`http://localhost:${port}/.neorest`);
      const { clientId } = await handshake.json() as { clientId: string };
      const startedAt = Date.now();
      const poll = await fetch(
        `http://localhost:${port}/.neorest?poll=true&clientId=${encodeURIComponent(clientId)}`,
      );
      const elapsed = Date.now() - startedAt;
      expect(poll.status).toBe(204);
      expect(elapsed).toBeGreaterThanOrEqual(100);
    } finally {
      await router.close();
    }
  });

  it('enforces configured origins and HTTP request limits', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter({
      port,
      disableWebSocket: true,
      cors: {
        origin: ['https://app.heswe.com'],
        credentials: true,
      },
      httpRateLimit: {
        windowMs: 1000,
        maxRequestsPerIp: 2,
      },
    });
    router.onGet('/ping', (ctx) => {
      ctx.response = 'pong';
    });
    await router.start();
    try {
      const denied = await fetch(`http://localhost:${port}/ping`, {
        headers: { Origin: 'https://attacker.example' },
      });
      expect(denied.status).toBe(403);

      const allowed = await fetch(`http://localhost:${port}/ping`, {
        headers: { Origin: 'https://app.heswe.com' },
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://app.heswe.com',
      );
      expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');

      const secondAllowed = await fetch(`http://localhost:${port}/ping`);
      expect(secondAllowed.status).toBe(200);
      const limited = await fetch(`http://localhost:${port}/ping`);
      expect(limited.status).toBe(429);
    } finally {
      await router.close();
    }
  });

  it('enforces the server-side protocol message limit', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter({
      port,
      disableWebSocket: true,
      maxMessagesPerSecond: 2,
    });
    router.onGet('/ping', (ctx) => {
      ctx.response = 'pong';
    });
    await router.start();

    const client = new Client(`http://localhost:${port}`, 'http', { timeout: 1000 });
    try {
      await client.connect();
      expect((await client.get('/ping')).status).toBe(200);
      expect((await client.get('/ping')).status).toBe(200);
      const limited = await client.get('/ping');
      expect(limited.status).toBe(429);
      expect(limited.error).toContain('Server message rate limit');
    } finally {
      client.close();
      await router.close();
    }
  });

  it('rejects handshakes after the logical connection limit is reached', async () => {
    const port = await portManager.getNextPort();
    const router = new NodeRouter({
      port,
      disableWebSocket: true,
      maxConnections: 1,
    });
    router.onGet('/ping', (ctx) => {
      ctx.response = 'pong';
    });
    await router.start();

    const first = new Client(`http://localhost:${port}`, 'http');
    try {
      await first.connect();
      expect((await first.get('/ping')).status).toBe(200);
      const denied = await fetch(`http://localhost:${port}/.neorest`);
      expect(denied.status).toBe(503);
      expect(await denied.json()).toEqual({ error: 'Server connection limit reached' });
    } finally {
      first.close();
      await router.close();
    }
  });
});

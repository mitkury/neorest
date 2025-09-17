// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NodeRouter } from 'neorest/node';
import { Client } from 'neorest';

async function startServer(port = 8120) {
  const router = new NodeRouter({ port });

  router
    .onGet('/whoami', async (ctx) => {
      const stratName = ctx.sender?.getStrategy()?.constructor?.name || 'unknown';
      ctx.response = { transport: stratName };
    })
    .onGet('/echo', async (ctx) => { ctx.response = { ok: true }; });

  await router.listen();
  return router;
}

describe('security: session takeover via reconnect secret', () => {
  let server: any;
  const port = 8120;

  beforeAll(async () => { server = await startServer(port); });
  afterAll(async () => { await server?.close(); });

  it('attacker can overtake via ws ?secret= (documenting current risk)', async () => {
    const victim = new Client(`http://localhost:${port}`, 'http');
    await (victim as any).conn.connect();

    // Baseline: victim transport is HTTP on the server
    const before = await victim.get<{ transport: string }>('/whoami');
    expect(before.error).toBeUndefined();
    expect(before.data.transport).toBe('HttpStrategy');

    const secret: string = (victim as any).conn.getSecret();
    expect(secret).toMatch(/^[a-f0-9]{64}$/);

    // Attacker connects over WS using the stolen secret
    const attacker = new Client(`ws://localhost:${port}`, 'websocket');
    // Inject secret via query parameters supported by WebSocketStrategy
    ((attacker as any).conn as any).strategy.setAuthentication({ secret });
    await ((attacker as any).conn as any).connect();

    // After hijack, victim requests are handled with sender mapped to WS connection
    const after = await victim.get<{ transport: string }>('/whoami');
    expect(after.error).toBeUndefined();
    expect(after.data.transport).toBe('WebSocketStrategy');

    (victim as any).close?.();
    (attacker as any).close?.();
  });
});

describe('security: random secret does not hijack', () => {
  let server: any;
  const port = 8121;
  beforeAll(async () => { server = await startServer(port); });
  afterAll(async () => { await server?.close(); });

  it('random ws ?secret does not affect existing session', async () => {
    const victim = new Client(`http://localhost:${port}`, 'http');
    await (victim as any).conn.connect();

    const before = await victim.get<{ transport: string }>('/whoami');
    expect(before.error).toBeUndefined();
    expect(before.data.transport).toBe('HttpStrategy');

    const randomSecret = Array.from({ length: 64 }, () => Math.floor(Math.random()*16).toString(16)).join('');
    const rando = new Client(`ws://localhost:${port}`, 'websocket');
    ((rando as any).conn as any).strategy.setAuthentication({ secret: randomSecret });
    await ((rando as any).conn as any).connect();

    const after = await victim.get<{ transport: string }>('/whoami');
    expect(after.error).toBeUndefined();
    expect(after.data.transport).toBe('HttpStrategy');

    (victim as any).close?.();
    (rando as any).close?.();
  });
});

describe('security: CORS headers present', () => {
  let server: any;
  const port = 8122;
  beforeAll(async () => { server = await startServer(port); });
  afterAll(async () => { await server?.close(); });

  it('transport OPTIONS has permissive CORS', async () => {
    const url = `http://localhost:${port}/.neorest`;
    const res = await fetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('route GET has Access-Control-Allow-Origin', async () => {
    const url = new URL(`http://localhost:${port}/echo`);
    url.searchParams.set('x', '1');
    const res = await fetch(url);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('security: client-side rate limit', () => {
  let server: any;
  const port = 8123;
  beforeAll(async () => { server = await startServer(port); });
  afterAll(async () => { await server?.close(); });

  it('sending >100 msgs/sec triggers local rate limit error', async () => {
    const client = new Client(`http://localhost:${port}`, 'http');
    await (client as any).conn.connect();

    const results: any[] = [];
    const promises: Promise<any>[] = [];
    const start = Date.now();
    for (let i = 0; i < 120; i++) {
      const p = (client as any).post('/echo', { n: i }).then((r: any) => results.push(r));
      promises.push(p);
    }
    await Promise.race([
      Promise.allSettled(promises),
      new Promise(r => setTimeout(r, 1500)),
    ]);

    const numRateLimited = results.filter(r => r?.error && String(r.error).includes('Rate limit')).length;
    expect(numRateLimited).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(2000);
    (client as any).close?.();
  });
});

describe('security: secret format/entropy basics', () => {
  it('newConnectionSecret produces 64-hex strings with low collision in small sample', async () => {
    const { newConnectionSecret } = await import('neorest/core');
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = newConnectionSecret();
      expect(s).toMatch(/^[a-f0-9]{64}$/);
      set.add(s);
    }
    expect(set.size).toBe(100);
  });
});


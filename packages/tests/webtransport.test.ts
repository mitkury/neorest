import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClientConnection,
  WebTransportTransport,
} from 'neorest';
import {
  MessageFrameDecoder,
  WebTransportSessionLike,
  WebTransportSessionTransport,
  encodeMessageFrame,
  new_MsgWrapper,
  PING,
} from 'neorest/core';
import { NodeRouter } from 'neorest/node';
import { portManager } from './utils/portManager';

describe('WebTransport framing', () => {
  it('decodes fragmented and coalesced protocol frames', () => {
    const first = new_MsgWrapper(1, { type: PING });
    const second = new_MsgWrapper(2, { type: PING });
    const bytes = concatenate(encodeMessageFrame(first), encodeMessageFrame(second));
    const decoder = new MessageFrameDecoder();

    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    expect(decoder.push(bytes.subarray(3))).toEqual([first, second]);
  });

  it('rejects oversized outbound and inbound frames', () => {
    const message = new_MsgWrapper(1, { type: PING, data: 'too large' } as any);
    expect(() => encodeMessageFrame(message, 8)).toThrow(/exceeds/);

    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 9, false);
    expect(() => new MessageFrameDecoder(8).push(header)).toThrow(/exceeds/);
  });

  it('moves messages in both directions over one reliable bidirectional stream', async () => {
    const pair = linkedSessions();
    const client = new WebTransportSessionTransport(pair.client, { role: 'client' });
    const server = new WebTransportSessionTransport(pair.server, { role: 'server' });
    const clientMessages: unknown[] = [];
    const serverMessages: unknown[] = [];
    client.onMessage((message) => clientMessages.push(message));
    server.onMessage((message) => serverMessages.push(message));

    await Promise.all([server.connect(), client.connect()]);
    const fromClient = new_MsgWrapper(1, { type: PING });
    const fromServer = new_MsgWrapper(2, { type: PING });
    client.send(fromClient);
    server.send(fromServer);
    await vi.waitFor(() => {
      expect(serverMessages).toEqual([fromClient]);
      expect(clientMessages).toEqual([fromServer]);
    });

    client.disconnect();
    server.disconnect();
  });

  it('times out when a peer never opens its protocol stream', async () => {
    const never = new Promise<never>(() => {});
    const session: WebTransportSessionLike = {
      ready: Promise.resolve(),
      closed: never,
      incomingBidirectionalStreams: new ReadableStream(),
      createBidirectionalStream: () => never,
      close: () => {},
    };
    const transport = new WebTransportSessionTransport(session, {
      role: 'server',
      streamTimeoutMs: 20,
    });
    await expect(transport.connect()).rejects.toThrow(/timed out/);
  });
});

describe.runIf(Number(process.versions.node.split('.')[0]) >= 20 && hasOpenSsl())(
  'WebTransport HTTP/3 integration',
  () => {
    it('preserves the authenticated principal through a real HTTP/3 route call', async () => {
      const certificateDirectory = mkdtempSync(join(tmpdir(), 'neorest-webtransport-'));
      const keyPath = join(certificateDirectory, 'key.pem');
      const certificatePath = join(certificateDirectory, 'cert.pem');
      execFileSync('openssl', [
        'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath,
      ]);
      execFileSync('openssl', [
        'req', '-new', '-x509', '-key', keyPath, '-out', certificatePath,
        '-subj', '/CN=localhost', '-days', '10',
        '-addext', 'basicConstraints=CA:FALSE',
        '-addext', 'keyUsage=digitalSignature,keyCertSign',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ]);
      const cert = readFileSync(certificatePath, 'utf8');
      const privateKey = readFileSync(keyPath, 'utf8');
      const certificateHash = createHash('sha256')
        .update(new X509Certificate(cert).raw)
        .digest();
      const httpPort = await portManager.getNextPort();
      const webTransportPort = await portManager.getNextPort();
      const router = new NodeRouter({
        port: httpPort,
        hostname: '127.0.0.1',
        disableWebSocket: true,
        disableHttpRoutes: true,
        webTransport: {
          port: webTransportPort,
          hostname: '127.0.0.1',
          publicUrl: `https://127.0.0.1:${webTransportPort}`,
          cert,
          privateKey,
        },
        authenticateConnection: ({ headers }) => {
          return headers.get('x-test-session') === 'valid'
            ? { id: 'user-1' }
            : null;
        },
      });
      router.onGet('/identity', (ctx) => {
        ctx.response = ctx.sender.getIdentity()?.id;
      });

      const originalWebTransport = (globalThis as any).WebTransport;
      let connection: ClientConnection | null = null;
      try {
        const provider = await import('@fails-components/webtransport') as any;
        await provider.quicheLoaded;
        (globalThis as any).WebTransport = provider.WebTransport;
        await router.start();

        const transport = new WebTransportTransport(`http://127.0.0.1:${httpPort}`, {
          serverCertificateHashes: [{
            algorithm: 'sha-256',
            value: certificateHash,
          }],
        });
        transport.setAuthentication({ 'x-test-session': 'valid' });
        connection = new ClientConnection(transport, {
          reconnect: false,
          timeout: 5_000,
        });
        await connection.connect();
        const response = await new Promise<any>((resolve) => {
          connection!.sendToRoute('/identity', 'GET', '', undefined, resolve);
        });
        expect(response).toMatchObject({ status: 200, data: 'user-1' });
      } finally {
        connection?.close();
        await router.close();
        (globalThis as any).WebTransport = originalWebTransport;
        rmSync(certificateDirectory, { recursive: true, force: true });
      }
    }, 20_000);
  },
);

describe('browser WebTransport bootstrap', () => {
  it('exchanges an authenticated HTTP handshake for a single-use upgrade URL', async () => {
    const pair = linkedSessions();
    const server = new WebTransportSessionTransport(pair.server, { role: 'server' });
    const originalWebTransport = (globalThis as any).WebTransport;
    const originalFetch = globalThis.fetch;
    let openedUrl = '';
    let request: RequestInit | undefined;

    (globalThis as any).WebTransport = class {
      constructor(url: string) {
        openedUrl = url;
        return pair.client;
      }
    };
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({
        clientId: 'client-1',
        upgradeToken: 'ticket-1',
        webTransportUrl: 'https://api.example.com:4443/.neorest',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new WebTransportTransport('https://api.example.com');
      transport.setConnectionSecret('secret-1');
      transport.setAuthentication({ 'X-Test-Session': 'cookie-bridge' });
      await Promise.all([server.connect(), transport.connect()]);

      const url = new URL(openedUrl);
      expect(url.searchParams.get('clientId')).toBe('client-1');
      expect(url.searchParams.get('upgradeToken')).toBe('ticket-1');
      expect(url.searchParams.get('secret')).toBe('secret-1');
      expect(request?.credentials).toBe('same-origin');
      expect(request?.headers).toMatchObject({ 'X-Test-Session': 'cookie-bridge' });
      transport.disconnect();
      server.disconnect();
    } finally {
      globalThis.fetch = originalFetch;
      (globalThis as any).WebTransport = originalWebTransport;
    }
  });
});

function linkedSessions(): {
  client: WebTransportSessionLike;
  server: WebTransportSessionLike;
} {
  const clientToServer = new TransformStream<Uint8Array, Uint8Array>();
  const serverToClient = new TransformStream<Uint8Array, Uint8Array>();
  const clientStream = {
    readable: serverToClient.readable,
    writable: clientToServer.writable,
  };
  const serverStream = {
    readable: clientToServer.readable,
    writable: serverToClient.writable,
  };
  let incomingController: ReadableStreamDefaultController<typeof serverStream>;
  let streamOpened = false;
  const incoming = new ReadableStream<typeof serverStream>({
    start(controller) {
      incomingController = controller;
    },
  });
  const closed = new Promise<unknown>(() => {});

  return {
    client: {
      ready: Promise.resolve(),
      closed,
      incomingBidirectionalStreams: new ReadableStream(),
      async createBidirectionalStream() {
        if (!streamOpened) {
          streamOpened = true;
          incomingController.enqueue(serverStream);
        }
        return clientStream;
      },
      close: () => {},
    },
    server: {
      ready: Promise.resolve(),
      closed,
      incomingBidirectionalStreams: incoming,
      createBidirectionalStream: async () => serverStream,
      close: () => {},
    },
  };
}

function concatenate(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function hasOpenSsl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpTransport } from '../neorest/src/transports/HttpTransport';

type Request = {
  init: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};
const requests: Request[] = [];
let transport: HttpTransport;
const handshake = (id: string) => Response.json({ clientId: id, upgradeToken: id });
const message = { id: -1, msg: { type: 'ping' } };

beforeEach(() => {
  vi.useFakeTimers();
  requests.length = 0;
  // Completion can race cancellation after the response body has arrived.
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => requests.push({ init, resolve, reject }))));
  transport = new HttpTransport('http://app.test');
});
afterEach(() => {
  transport.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function connect(id: string) {
  const connected = transport.connect();
  requests.at(-1)!.resolve(handshake(id));
  await connected;
}
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('HTTP connection cancellation', () => {
  it('does not reopen after disconnect during the handshake', async () => {
    const opened = vi.fn();
    transport.onOpen(opened);
    const connected = transport.connect();
    const rejected = expect(connected).rejects.toMatchObject({ name: 'AbortError' });
    transport.disconnect();
    requests[0].resolve(handshake('stale'));
    await rejected;
    expect(requests[0].init.signal?.aborted).toBe(true);
    expect(transport.isConnected()).toBe(false);
    expect(transport.getUpgradeInfo()).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });
  it('shares a pending handshake between concurrent connects', async () => {
    const first = transport.connect();
    const second = transport.connect();
    expect(requests).toHaveLength(1);
    requests[0].resolve(handshake('current'));
    await Promise.all([first, second]);
    expect(transport.isConnected()).toBe(true);
  });
  it.each(['response', 'error'])('ignores a late send %s from a closed session', async (outcome) => {
    const received = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    transport.onMessage(received);
    try {
      await connect('old');
      transport.send(message);
      const oldSend = requests.at(-1)!;
      transport.disconnect();
      await connect('new');
      transport.send(message);
      const newSend = requests.at(-1)!;
      if (outcome === 'response') oldSend.resolve(Response.json(message));
      else oldSend.reject(new Error('old socket closed'));
      await flush();
      expect(oldSend.init.signal?.aborted).toBe(true);
      expect(transport.isConnected()).toBe(true);
      expect(transport.hasPendingSends()).toBe(true);
      expect(received).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      newSend.resolve(new Response(null, { status: 204 }));
      await flush();
      expect(transport.hasPendingSends()).toBe(false);
    } finally { errors.mockRestore(); }
  });
  it('keeps the new poll cancellable when an old poll completes late', async () => {
    const received = vi.fn();
    transport.onMessage(received);
    await connect('old');
    await vi.advanceTimersByTimeAsync(0);
    const oldPoll = requests.at(-1)!;
    transport.disconnect();
    await connect('new');
    await vi.advanceTimersByTimeAsync(0);
    const newPoll = requests.at(-1)!;
    oldPoll.resolve(Response.json(message));
    await flush();
    expect(received).not.toHaveBeenCalled();
    transport.disconnect();
    expect(newPoll.init.signal?.aborted).toBe(true);
  });
});

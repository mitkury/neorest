import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketTransport } from '../neorest/src/transports/WebSocketTransport';

class TestSocket extends EventTarget {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {
    super();
    TestSocket.instances.push(this);
  }
  open() {
    this.readyState = TestSocket.OPEN;
    this.onopen?.();
    this.dispatchEvent(new Event('open'));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
    this.dispatchEvent(new Event('close'));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestSocket.instances = [];
});

describe('WebSocket callback ownership', () => {
  it('keeps stale-socket guards when callbacks are registered after connect', async () => {
    vi.stubGlobal('WebSocket', TestSocket);
    const transport = new WebSocketTransport('ws://app.test');
    const first = transport.connect();
    const oldSocket = TestSocket.instances[0];
    oldSocket.open();
    await first;
    const opened = vi.fn(),
      closed = vi.fn(),
      received = vi.fn();
    transport.onOpen(opened);
    transport.onClose(closed);
    transport.onMessage(received);
    const stale = {
      open: oldSocket.onopen,
      close: oldSocket.onclose,
      message: oldSocket.onmessage,
    };
    transport.disconnect();
    const next = transport.connect();
    TestSocket.instances[1].open();
    await next;
    opened.mockClear();
    closed.mockClear();
    received.mockClear();
    try {
      stale.open?.();
      stale.close?.();
      stale.message?.(
        new MessageEvent('message', {
          data: JSON.stringify({ id: -1, msg: { type: 'ping' } }),
        }),
      );
      expect(opened).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      expect(received).not.toHaveBeenCalled();
      expect(transport.getConnectionInfo().status).toBe('connected');
    } finally {
      transport.disconnect();
    }
  });
});

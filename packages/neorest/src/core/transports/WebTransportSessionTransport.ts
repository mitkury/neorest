import { CommunicationTransport } from '../CommunicationTransport';
import { MsgWrapper } from '../types';
import {
  encodeMessageFrame,
  MessageFrameDecoder,
} from '../utils/MessageFrameCodec';

export interface WebTransportBidirectionalStreamLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export interface WebTransportSessionLike {
  ready: Promise<void>;
  closed: Promise<unknown>;
  incomingBidirectionalStreams: ReadableStream<WebTransportBidirectionalStreamLike>;
  createBidirectionalStream(): Promise<WebTransportBidirectionalStreamLike>;
  close(info?: { closeCode?: number; reason?: string }): void;
}

export interface WebTransportSessionTransportOptions {
  role: 'client' | 'server';
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  streamTimeoutMs?: number;
}

/**
 * Adapts one reliable WebTransport bidirectional stream to Neorest's framed
 * message protocol.
 */
export class WebTransportSessionTransport implements CommunicationTransport {
  private readonly decoder: MessageFrameDecoder;
  private readonly maxFrameBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly streamTimeoutMs: number;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private messageCallback: ((message: MsgWrapper) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private openCallback: (() => void) | null = null;
  private connected = false;
  private closing = false;
  private closeEmitted = false;
  private bufferedBytes = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly session: WebTransportSessionLike,
    private readonly options: WebTransportSessionTransportOptions,
  ) {
    this.maxFrameBytes = options.maxFrameBytes ?? 1024 * 1024;
    this.maxBufferedBytes = options.maxBufferedBytes ?? this.maxFrameBytes * 4;
    this.streamTimeoutMs = options.streamTimeoutMs ?? 10_000;
    if (!Number.isInteger(this.maxBufferedBytes) || this.maxBufferedBytes < this.maxFrameBytes) {
      throw new Error('maxBufferedBytes must be an integer at least as large as maxFrameBytes');
    }
    if (!Number.isInteger(this.streamTimeoutMs) || this.streamTimeoutMs <= 0) {
      throw new Error('streamTimeoutMs must be a positive integer');
    }
    this.decoder = new MessageFrameDecoder(this.maxFrameBytes);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.closing = false;
    this.closeEmitted = false;
    await withTimeout(this.session.ready, this.streamTimeoutMs, 'WebTransport session handshake');

    const stream = this.options.role === 'client'
      ? await withTimeout(
          this.session.createBidirectionalStream(),
          this.streamTimeoutMs,
          'WebTransport stream creation',
        )
      : await this.acceptIncomingStream();

    if (this.closing) throw new Error('WebTransport connection closed during setup');
    this.writer = stream.writable.getWriter();
    this.reader = stream.readable.getReader();
    this.connected = true;
    this.openCallback?.();
    void this.readLoop();
    void Promise.resolve(this.session.closed).then(
      () => this.handleClosed(),
      () => this.handleClosed(),
    );
  }

  disconnect(): void {
    if (this.closing) return;
    this.closing = true;
    const wasConnected = this.connected;
    this.connected = false;
    this.decoder.reset();
    this.releaseStreams();
    try {
      this.session.close({ closeCode: 0, reason: 'Neorest transport closed' });
    } catch {
      // Best-effort close.
    }
    if (wasConnected) this.emitClose();
  }

  private releaseStreams(): void {
    const reader = this.reader;
    void reader?.cancel().catch(() => {}).finally(() => {
      try {
        reader.releaseLock();
      } catch {
        // A pending read may keep the lock until cancellation settles.
      }
    });
    this.reader = null;
    const writer = this.writer;
    void writer?.abort('Neorest transport closed').catch(() => {}).finally(() => {
      try {
        writer.releaseLock();
      } catch {
        // Best-effort release after abort.
      }
    });
    this.writer = null;
  }

  send(message: MsgWrapper): void {
    if (!this.connected || !this.writer) {
      throw new Error('WebTransport connection is not established');
    }
    const frame = encodeMessageFrame(message, this.maxFrameBytes);
    if (this.bufferedBytes + frame.byteLength > this.maxBufferedBytes) {
      throw new Error(`WebTransport send buffer exceeds the ${this.maxBufferedBytes} byte limit`);
    }
    this.bufferedBytes += frame.byteLength;
    const writer = this.writer;
    this.writeChain = this.writeChain
      .then(async () => {
        await writer.ready;
        await writer.write(frame);
      })
      .catch((error) => this.fail(error))
      .finally(() => {
        this.bufferedBytes -= frame.byteLength;
      });
  }

  onMessage(callback: (message: MsgWrapper) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.openCallback = callback;
    if (this.connected) callback();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async acceptIncomingStream(): Promise<WebTransportBidirectionalStreamLike> {
    const incoming = this.session.incomingBidirectionalStreams.getReader();
    try {
      const result = await withTimeout(
        incoming.read(),
        this.streamTimeoutMs,
        'WebTransport stream acceptance',
      );
      if (result.done || !result.value) {
        throw new Error('WebTransport session closed before opening a Neorest stream');
      }
      return result.value;
    } catch (error) {
      await incoming.cancel().catch(() => {});
      throw error;
    } finally {
      try {
        incoming.releaseLock();
      } catch {
        // Cancellation may settle just after a stream-accept timeout.
      }
    }
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      while (this.connected) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        for (const message of this.decoder.push(value)) {
          this.messageCallback?.(message);
        }
      }
      this.handleClosed();
    } catch (error) {
      if (!this.closing) this.handleClosed();
    } finally {
      if (this.reader === reader) {
        this.reader = null;
        try {
          reader.releaseLock();
        } catch {
          // The stream may still be unwinding after a session close.
        }
      }
    }
  }

  private fail(error: unknown): void {
    if (this.closing) return;
    console.error('WebTransport transport error:', error);
    this.disconnect();
  }

  private handleClosed(): void {
    const wasConnected = this.connected;
    this.connected = false;
    if (!this.closing) {
      this.closing = true;
      this.decoder.reset();
      this.releaseStreams();
    }
    if (wasConnected || !this.closeEmitted) this.emitClose();
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    this.closeCallback?.();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

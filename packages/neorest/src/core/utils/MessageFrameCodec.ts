import { MsgWrapper } from '../types';

const FRAME_HEADER_BYTES = 4;
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

export function encodeMessageFrame(
  message: MsgWrapper,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  if (payload.byteLength > maxFrameBytes) {
    throw new Error(`Message frame exceeds the ${maxFrameBytes} byte limit`);
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, FRAME_HEADER_BYTES);
  return frame;
}

export class MessageFrameDecoder {
  private buffer = new Uint8Array(0);

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes <= 0) {
      throw new Error('maxFrameBytes must be a positive integer');
    }
  }

  push(chunk: Uint8Array): MsgWrapper[] {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('Message frame chunks must be Uint8Array values');
    }
    if (chunk.byteLength === 0) return [];
    const combined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    combined.set(this.buffer);
    combined.set(chunk, this.buffer.byteLength);
    this.buffer = combined;

    const messages: MsgWrapper[] = [];
    let offset = 0;
    while (this.buffer.byteLength - offset >= FRAME_HEADER_BYTES) {
      const frameBytes = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset + offset,
        FRAME_HEADER_BYTES,
      ).getUint32(0, false);
      if (frameBytes > this.maxFrameBytes) {
        throw new Error(`Message frame exceeds the ${this.maxFrameBytes} byte limit`);
      }
      const frameEnd = offset + FRAME_HEADER_BYTES + frameBytes;
      if (frameEnd > this.buffer.byteLength) break;

      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder().decode(this.buffer.subarray(offset + FRAME_HEADER_BYTES, frameEnd)),
        );
      } catch {
        throw new Error('Message frame contains invalid JSON');
      }
      if (!isMessageWrapper(parsed)) {
        throw new Error('Message frame contains an invalid protocol envelope');
      }
      messages.push(parsed);
      offset = frameEnd;
    }

    this.buffer = this.buffer.slice(offset);
    if (this.buffer.byteLength > this.maxFrameBytes + FRAME_HEADER_BYTES) {
      throw new Error(`Buffered message frame exceeds the ${this.maxFrameBytes} byte limit`);
    }
    return messages;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

export function isMessageWrapper(value: unknown): value is MsgWrapper {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; msg?: { type?: unknown } };
  return (
    Number.isInteger(candidate.id)
    && (candidate.id as number) >= -1
    && Boolean(candidate.msg)
    && typeof candidate.msg?.type === 'string'
  );
}

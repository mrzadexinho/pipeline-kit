/**
 * End-to-end wire integration tests (acceptance criterion #14).
 *
 * Combines all wire pieces: attachTraceToFrame → encode → decode →
 * extractTraceFromFrame, verifying W3C Trace Context survives both
 * NDJSON and LSP wire modes.
 */

import { describe, expect, it } from 'vitest';
import type { SerializableContext } from '../../src/serializable-context.js';
import {
  decodeLspAsyncIter,
  decodeLspStream,
  decodeNdjsonAsyncIter,
  decodeNdjsonStream,
  encodeLspStream,
  encodeNdjsonStream,
} from '../../src/wire/index.js';
import { attachTraceToFrame, extractTraceFromFrame } from '../../src/wire/trace-wire.js';
import type { WireFrame } from '../../src/wire/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const W3C_TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01';

const ctx: SerializableContext = {
  runId: 'pk_run_test',
  trace: { traceparent: W3C_TRACEPARENT },
  idempotencyKey: 'idem-test',
};

// Atom-shaped body with metadata so trace survives NDJSON encoding
type TestBody = { id: string; metadata: Record<string, unknown>; value: number };

function makeFrames(count: number): WireFrame<TestBody>[] {
  return Array.from({ length: count }, (_, i) => ({
    body: {
      id: `pk_atom_01HFOOBARBAZ12345678${String(i).padStart(6, '0')}`,
      metadata: { index: i },
      value: i * 10,
    },
  }));
}

// Helper: collect async iterable to array
async function collectAsyncIter<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) {
    out.push(item);
  }
  return out;
}

// Helper: split Uint8Array into chunks of given size
function chunkedUint8(buf: Uint8Array, chunkSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < buf.byteLength; i += chunkSize) {
    chunks.push(buf.subarray(i, i + chunkSize));
  }
  return chunks;
}

async function* toAsyncIter(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// 1. NDJSON end-to-end WITH trace context (acceptance criterion #14)
// ---------------------------------------------------------------------------

describe('NDJSON end-to-end with trace context', () => {
  it('5 frames: trace survives encode → decode via body.metadata', () => {
    const frames = makeFrames(5);
    const attached = frames.map((f) => attachTraceToFrame(f, ctx));
    const encoded = encodeNdjsonStream(attached);
    const decoded = decodeNdjsonStream<TestBody>(encoded);

    expect(decoded).toHaveLength(5);
    for (const frame of decoded) {
      expect(frame.error).toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: frame.error asserted null above
      const extracted = extractTraceFromFrame(frame.data!);
      expect(extracted?.traceparent).toBe(W3C_TRACEPARENT);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. LSP end-to-end WITH trace context (acceptance criterion #14)
// ---------------------------------------------------------------------------

describe('LSP end-to-end with trace context', () => {
  it('5 frames: trace survives encode → decode via LSP headers', () => {
    const frames = makeFrames(5);
    const attached = frames.map((f) => attachTraceToFrame(f, ctx));
    const encoded = encodeLspStream(attached);
    const decoded = decodeLspStream<TestBody>(encoded);

    expect(decoded).toHaveLength(5);
    for (const frame of decoded) {
      expect(frame.error).toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: frame.error asserted null above
      const extracted = extractTraceFromFrame(frame.data!);
      expect(extracted?.traceparent).toBe(W3C_TRACEPARENT);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. NDJSON end-to-end WITHOUT trace context
// ---------------------------------------------------------------------------

describe('NDJSON end-to-end without trace context', () => {
  it('5 frames: bodies match exactly after encode → decode', () => {
    const frames = makeFrames(5);
    const encoded = encodeNdjsonStream(frames);
    const decoded = decodeNdjsonStream<TestBody>(encoded);

    expect(decoded).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(decoded[i]?.error).toBeNull();
      // Compare value field (canonical JSON sorts keys so objects compare equal)
      expect(decoded[i]?.data?.body.value).toBe(i * 10);
      expect(decoded[i]?.data?.body.id).toContain('pk_atom_');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. LSP end-to-end WITHOUT trace context
// ---------------------------------------------------------------------------

describe('LSP end-to-end without trace context', () => {
  it('5 frames: bodies match exactly after encode → decode', () => {
    const frames = makeFrames(5);
    const encoded = encodeLspStream(frames);
    const decoded = decodeLspStream<TestBody>(encoded);

    expect(decoded).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(decoded[i]?.error).toBeNull();
      expect(decoded[i]?.data?.body.value).toBe(i * 10);
      expect(decoded[i]?.data?.body.id).toContain('pk_atom_');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Async-iter end-to-end NDJSON with trace context
// ---------------------------------------------------------------------------

describe('Async-iter NDJSON end-to-end with trace context', () => {
  it('3 frames chunked at arbitrary byte boundaries: trace context intact', async () => {
    const frames = makeFrames(3);
    const attached = frames.map((f) => attachTraceToFrame(f, ctx));
    const encoded = encodeNdjsonStream(attached);

    const enc = new TextEncoder();
    const bytes = enc.encode(encoded);
    // Chunk at 7 bytes — arbitrary, crosses JSON boundaries
    const chunks = chunkedUint8(bytes, 7);

    const decoded = await collectAsyncIter(decodeNdjsonAsyncIter<TestBody>(toAsyncIter(chunks)));

    expect(decoded).toHaveLength(3);
    for (const frame of decoded) {
      expect(frame.error).toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: frame.error asserted null above
      const extracted = extractTraceFromFrame(frame.data!);
      expect(extracted?.traceparent).toBe(W3C_TRACEPARENT);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Async-iter end-to-end LSP with trace context
// ---------------------------------------------------------------------------

describe('Async-iter LSP end-to-end with trace context', () => {
  it('3 frames chunked at arbitrary byte boundaries: trace context intact', async () => {
    const frames = makeFrames(3);
    const attached = frames.map((f) => attachTraceToFrame(f, ctx));
    const encoded = encodeLspStream(attached);

    // Chunk at 11 bytes — arbitrary, crosses header boundaries
    const chunks = chunkedUint8(encoded, 11);

    const decoded = await collectAsyncIter(decodeLspAsyncIter<TestBody>(toAsyncIter(chunks)));

    expect(decoded).toHaveLength(3);
    for (const frame of decoded) {
      expect(frame.error).toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: frame.error asserted null above
      const extracted = extractTraceFromFrame(frame.data!);
      expect(extracted?.traceparent).toBe(W3C_TRACEPARENT);
    }
  });
});

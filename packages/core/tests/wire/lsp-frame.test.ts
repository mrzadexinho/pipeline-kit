import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/wire/canonical-json.js';
import {
  decodeLspAsyncIter,
  decodeLspStream,
  encodeLspFrame,
  encodeLspStream,
} from '../../src/wire/lsp-frame.js';
import type { WireFrame } from '../../src/wire/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();

function str2bytes(s: string): Uint8Array {
  return TEXT_ENCODER.encode(s);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.byteLength;
  }
  return out;
}

/** Split a Uint8Array into chunks of `chunkSize` bytes. */
function splitChunks(buf: Uint8Array, chunkSize: number): Uint8Array[] {
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

async function collectAsyncIter<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iter) {
    results.push(item);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const jsonSafeArb = fc.letrec((tie) => ({
  value: fc.oneof(
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1e9, max: 1e9 }),
    fc.float({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }),
    fc.string({ maxLength: 20 }),
    fc.array(tie('value') as fc.Arbitrary<unknown>, { maxLength: 5 }),
    fc.dictionary(
      fc.string({ maxLength: 10 }).filter((s) => s.length > 0),
      tie('value') as fc.Arbitrary<unknown>,
      { maxKeys: 5 },
    ),
  ),
})).value;

const frameArb = jsonSafeArb.map((v) => ({ body: v }));
const framesArb = fc.array(frameArb, { minLength: 1, maxLength: 20 });

// ---------------------------------------------------------------------------
// encodeLspFrame
// ---------------------------------------------------------------------------

describe('encodeLspFrame', () => {
  it('produces Content-Length header with correct UTF-8 byte count', () => {
    const frame: WireFrame<unknown> = { body: { id: 1 } };
    const bytes = encodeLspFrame(frame);
    const text = new TextDecoder().decode(bytes);
    expect(text).toMatch(/^Content-Length: \d+\r\n/);
  });

  it('UTF-8 multi-byte: Content-Length equals byte count, not char count', () => {
    // CJK chars are 3 bytes each in UTF-8
    const body = { title: '日本語' }; // 日本語
    const frame: WireFrame<unknown> = { body };
    const bytes = encodeLspFrame(frame);
    const text = new TextDecoder().decode(bytes);

    const clMatch = /^Content-Length: (\d+)\r\n/.exec(text);
    expect(clMatch).not.toBeNull();
    const declaredLen = parseInt(clMatch?.[1], 10);

    // Find header terminator position
    let terminatorPos = -1;
    for (let i = 0; i <= bytes.byteLength - 4; i++) {
      if (
        bytes[i] === 0x0d &&
        bytes[i + 1] === 0x0a &&
        bytes[i + 2] === 0x0d &&
        bytes[i + 3] === 0x0a
      ) {
        terminatorPos = i;
        break;
      }
    }
    expect(terminatorPos).toBeGreaterThan(0);
    const actualBodyLen = bytes.byteLength - terminatorPos - 4;
    expect(declaredLen).toBe(actualBodyLen);

    // Verify byte count != char count for this payload
    const bodyJson = new TextDecoder().decode(bytes.subarray(terminatorPos + 4));
    expect(declaredLen).not.toBe(bodyJson.length);
  });

  it('includes traceparent header when frame has traceparent', () => {
    const frame: WireFrame<unknown> = {
      body: { x: 1 },
      traceparent: '00-abc-def-01',
    };
    const bytes = encodeLspFrame(frame);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('traceparent: 00-abc-def-01\r\n');
  });

  it('includes tracestate header after traceparent when both present', () => {
    const frame: WireFrame<unknown> = {
      body: { x: 1 },
      traceparent: '00-abc-def-01',
      tracestate: 'vendor=val',
    };
    const bytes = encodeLspFrame(frame);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('traceparent: 00-abc-def-01\r\n');
    expect(text).toContain('tracestate: vendor=val\r\n');
  });
});

// ---------------------------------------------------------------------------
// decodeLspStream -- happy path
// ---------------------------------------------------------------------------

describe('decodeLspStream happy path', () => {
  it('empty input returns empty array', () => {
    expect(decodeLspStream(new Uint8Array(0))).toEqual([]);
  });

  it('round-trips a single frame', () => {
    const frame: WireFrame<unknown> = { body: { a: 1 } };
    const encoded = encodeLspFrame(frame);
    const results = decodeLspStream(encoded);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBeNull();
    expect(results[0].data?.body).toEqual({ a: 1 });
  });

  it('round-trips multiple frames', () => {
    const frames: WireFrame<unknown>[] = [{ body: { n: 1 } }, { body: 'hello' }, { body: null }];
    const encoded = encodeLspStream(frames);
    const results = decodeLspStream(encoded);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.data?.body)).toEqual([{ n: 1 }, 'hello', null]);
  });

  it('preserves traceparent + tracestate through encode/decode', () => {
    const frame: WireFrame<unknown> = {
      body: { id: 'pk_atom_x' },
      traceparent: '00-trace123-span456-01',
      tracestate: 'svc=api',
    };
    const encoded = encodeLspFrame(frame);
    const results = decodeLspStream(encoded);
    expect(results).toHaveLength(1);
    expect(results[0].data?.traceparent).toBe('00-trace123-span456-01');
    expect(results[0].data?.tracestate).toBe('svc=api');
  });

  it('UTF-8 multi-byte round-trip (emoji + CJK)', () => {
    const payload = { emoji: '🎉', japanese: '日本語' };
    const encoded = encodeLspStream([{ body: payload }]);
    const results = decodeLspStream(encoded);
    expect(results).toHaveLength(1);
    expect(results[0].data?.body).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// decodeLspStream -- strict header enforcement (spike-3 fixtures)
// ---------------------------------------------------------------------------

describe('decodeLspStream strict header enforcement', () => {
  it('spike-3 flush=True fixture: debug bytes BETWEEN frames emit wire/unknown_header (NOT silent pass)', () => {
    // CRITICAL: closes the spike-3 print(flush=True) silent-pass class.
    // Python stray print between frames lands before the next Content-Length header.
    // Strict decoder MUST reject it, NOT silently absorb as preamble.
    const frame1 = encodeLspFrame({ body: { seq: 1 } });
    const debugBytes = str2bytes('debug: about to process atom 2\n');
    const frame2 = encodeLspFrame({ body: { seq: 2 } });
    const raw = concat(frame1, debugBytes, frame2);

    const results = decodeLspStream(raw);
    expect(results[0].error).toBeNull();
    expect(results[0].data?.body).toEqual({ seq: 1 });
    // Debug bytes MUST emit unknown_header (not silent pass)
    expect(results[1].error?.code).toBe('wire/unknown_header');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('spike-3 no-flush fixture: trailing debug bytes after last frame emit a decode error (NOT silent pass)', () => {
    // Decoder attempts to parse trailing bytes as a 4th frame header.
    // If those bytes contain a recognisable first line that is NOT Content-Length:,
    // unknown_header fires. If the bytes have no \r\n\r\n terminator (which `debug bytes\n`
    // does not), truncated_body fires instead. Either way the decoder MUST NOT silently
    // drop trailing bytes — any error code is acceptable, silence is not.
    const frame1 = encodeLspFrame({ body: { seq: 1 } });
    const frame2 = encodeLspFrame({ body: { seq: 2 } });
    const frame3 = encodeLspFrame({ body: { seq: 3 } });
    const debugBytes = str2bytes('debug bytes\n');
    const raw = concat(frame1, frame2, frame3, debugBytes);

    const results = decodeLspStream(raw);
    expect(results[0].data?.body).toEqual({ seq: 1 });
    expect(results[1].data?.body).toEqual({ seq: 2 });
    expect(results[2].data?.body).toEqual({ seq: 3 });
    // 4th result must be an error (not silent pass)
    expect(results.length).toBeGreaterThanOrEqual(4);
    expect(results[3]?.error).not.toBeNull();
  });

  it('content-length-lying fixture (spike-3 B-4): emits wire/truncated_body', () => {
    // CRITICAL: closes the content-length-lying class.
    // Declare Content-Length: 100 but only supply 8 body bytes.
    const realBody = str2bytes('{"id":1}'); // 8 bytes
    const fakeLen = 100;
    const headerStr = `Content-Length: ${fakeLen}\r\n\r\n`;
    const headerBytes = str2bytes(headerStr);
    const raw = concat(headerBytes, realBody);

    const results = decodeLspStream(raw);
    expect(results).toHaveLength(1);
    expect(results[0].error?.code).toBe('wire/truncated_body');
  });

  it('rejects unknown header on first line', () => {
    // After emitting unknown_header, decoder advances past \r\n\r\n and tries to
    // parse the remaining bytes `{}` as a new frame. Since `{}` has no terminator,
    // a second error fires. We assert the first error code is correct.
    const raw = str2bytes('X-Custom: foo\r\n\r\n{}');
    const results = decodeLspStream(raw);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].error?.code).toBe('wire/unknown_header');
  });

  it('rejects unknown second-line header (only traceparent/tracestate allowed)', () => {
    // Decoder emits unknown_header, advances past \r\n\r\n, then tries to parse the
    // body bytes as a new frame header — a second error may follow.
    const body = str2bytes('{"x":1}');
    const headerStr = `Content-Length: ${body.byteLength}\r\nX-Secret: value\r\n\r\n`;
    const raw = concat(str2bytes(headerStr), body);
    const results = decodeLspStream(raw);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].error?.code).toBe('wire/unknown_header');
  });

  it('header too large (>8 KiB without terminator) emits wire/header_too_large', () => {
    const buf = new Uint8Array(8193).fill(0x41); // 8193 'A' bytes, no CRLF CRLF
    const results = decodeLspStream(buf);
    expect(results).toHaveLength(1);
    expect(results[0].error?.code).toBe('wire/header_too_large');
  });

  it('Content-Length header key is case-insensitive', () => {
    const body = str2bytes('{"a":1}');
    const headerStr = `content-length: ${body.byteLength}\r\n\r\n`;
    const raw = concat(str2bytes(headerStr), body);
    const results = decodeLspStream(raw);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBeNull();
    expect(results[0].data?.body).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('decodeLspStream property tests', () => {
  it('round-trip property: decode(encode(frames)) returns frame bodies', () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        const encoded = encodeLspStream(frames);
        const results = decodeLspStream(encoded);
        expect(results).toHaveLength(frames.length);
        for (let i = 0; i < frames.length; i++) {
          expect(results[i].error).toBeNull();
          // Use canonicalize for comparison since encode sorts keys;
          // JSON.stringify does not sort, so key insertion order would differ.
          expect(canonicalize(results[i].data?.body)).toBe(canonicalize(frames[i].body));
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// decodeLspAsyncIter
// ---------------------------------------------------------------------------

describe('decodeLspAsyncIter', () => {
  it('async iter round-trip: 5 frames with arbitrary chunking (mid-header + mid-body)', async () => {
    const frames: WireFrame<unknown>[] = [
      { body: { id: 1 } },
      { body: 'hello' },
      { body: null },
      { body: [1, 2, 3] },
      { body: { nested: { deep: true } } },
    ];
    const encoded = encodeLspStream(frames);
    // 7-byte chunks ensure splits happen mid-header and mid-body
    const chunks = splitChunks(encoded, 7);
    const results = await collectAsyncIter(decodeLspAsyncIter(toAsyncIter(chunks)));

    expect(results).toHaveLength(5);
    for (let i = 0; i < frames.length; i++) {
      expect(results[i].error).toBeNull();
      expect(results[i].data?.body).toEqual(frames[i].body);
    }
  });

  it('async iter: empty source yields no frames', async () => {
    async function* empty(): AsyncIterable<Uint8Array> {}
    const results = await collectAsyncIter(decodeLspAsyncIter(empty()));
    expect(results).toEqual([]);
  });

  it('async iter: traceparent preserved through chunked delivery', async () => {
    const frame: WireFrame<unknown> = {
      body: { x: 42 },
      traceparent: '00-aaaa-bbbb-01',
    };
    const encoded = encodeLspFrame(frame);
    const chunks = splitChunks(encoded, 4);
    const results = await collectAsyncIter(decodeLspAsyncIter(toAsyncIter(chunks)));
    expect(results).toHaveLength(1);
    expect(results[0].data?.traceparent).toBe('00-aaaa-bbbb-01');
  });

  it('async iter: debug bytes between frames emit wire/unknown_header (flush=True spike)', async () => {
    const frame1 = encodeLspFrame({ body: { seq: 1 } });
    const debugBytes = str2bytes('debug: stray print\n');
    const frame2 = encodeLspFrame({ body: { seq: 2 } });
    const raw = concat(frame1, debugBytes, frame2);
    const chunks = splitChunks(raw, 10);
    const results = await collectAsyncIter(decodeLspAsyncIter(toAsyncIter(chunks)));

    expect(results[0].data?.body).toEqual({ seq: 1 });
    expect(results[1].error?.code).toBe('wire/unknown_header');
  });
});

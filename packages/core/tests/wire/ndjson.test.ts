import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/wire/canonical-json.js';
import {
  decodeNdjsonAsyncIter,
  decodeNdjsonStream,
  encodeNdjsonFrame,
  encodeNdjsonStream,
} from '../../src/wire/ndjson.js';
import type { WireFrame } from '../../src/wire/types.js';

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

// Helper: collect async iter to array
async function collectAsyncIter<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iter) {
    results.push(item);
  }
  return results;
}

// Helper: split a string into Uint8Array chunks at arbitrary byte boundaries
function chunkedUint8(text: string, chunkSize: number): Uint8Array[] {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    chunks.push(bytes.subarray(i, i + chunkSize));
  }
  return chunks;
}

async function* toAsyncIter(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// encodeNdjsonFrame
// ---------------------------------------------------------------------------

describe('encodeNdjsonFrame', () => {
  it('serializes body as canonical JSON — sorted keys, no whitespace', () => {
    const frame: WireFrame<unknown> = { body: { z: 1, a: 2 } };
    expect(encodeNdjsonFrame(frame)).toBe('{"a":2,"z":1}');
  });

  it('ignores traceparent/tracestate fields (ADR IX-4 asymmetry)', () => {
    const frame: WireFrame<unknown> = {
      body: { id: 1 },
      traceparent: '00-trace-span-01',
      tracestate: 'vendor=val',
    };
    // Output must be just the body, no trace fields embedded
    expect(encodeNdjsonFrame(frame)).toBe('{"id":1}');
  });
});

// ---------------------------------------------------------------------------
// encodeNdjsonStream
// ---------------------------------------------------------------------------

describe('encodeNdjsonStream', () => {
  it('empty frames array returns empty string', () => {
    expect(encodeNdjsonStream([])).toBe('');
  });

  it('single frame has trailing newline', () => {
    const out = encodeNdjsonStream([{ body: { x: 1 } }]);
    expect(out).toBe('{"x":1}\n');
  });

  it('multiple frames each terminated by newline', () => {
    const frames: WireFrame<unknown>[] = [{ body: 1 }, { body: 2 }, { body: 3 }];
    const out = encodeNdjsonStream(frames);
    expect(out).toBe('1\n2\n3\n');
  });

  it('output ends with a single newline', () => {
    const out = encodeNdjsonStream([{ body: 'a' }, { body: 'b' }]);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(-2)).toBe('"\n'); // last char is \n, not \n\n
  });
});

// ---------------------------------------------------------------------------
// decodeNdjsonStream
// ---------------------------------------------------------------------------

describe('decodeNdjsonStream', () => {
  it('empty string returns empty array', () => {
    expect(decodeNdjsonStream('')).toEqual([]);
  });

  it('round-trips a single frame', () => {
    const raw = '{"a":1}\n';
    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBeNull();
    expect(results[0].data).toEqual({ body: { a: 1 } });
  });

  it('round-trips multiple frames', () => {
    const raw = '1\n"hello"\nnull\n';
    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.data?.body)).toEqual([1, 'hello', null]);
  });

  it('empty line emits wire/malformed_line error', () => {
    const raw = '{"a":1}\n\n{"b":2}\n';
    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(3);
    expect(results[0].data?.body).toEqual({ a: 1 });
    expect(results[1].error?.code).toBe('wire/malformed_line');
    expect(results[2].data?.body).toEqual({ b: 2 });
  });

  it('malformed JSON emits wire/malformed_json error with near field', () => {
    const raw = '{"a":1}\nnot-json\n{"b":2}\n';
    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(3);
    expect(results[0].data?.body).toEqual({ a: 1 });
    expect(results[1].error?.code).toBe('wire/malformed_json');
    expect(results[1].error?.near).toBe('not-json');
    expect(results[2].data?.body).toEqual({ b: 2 });
  });

  it('stray debug text mid-stream (spike-2 fixture) — frames before/after still parse', () => {
    // Simulates: valid JSON, then debug text, then valid JSON
    const frame1 = '{"type":"result","id":"pk_atom_1"}';
    const stray = 'debug: about to process atom 2';
    const frame2 = '{"type":"result","id":"pk_atom_2"}';
    const raw = `${frame1}\n${stray}\n${frame2}\n`;

    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(3);
    expect(results[0].error).toBeNull();
    expect(results[0].data?.body).toEqual({ type: 'result', id: 'pk_atom_1' });
    expect(results[1].error?.code).toBe('wire/malformed_json');
    expect(results[2].error).toBeNull();
    expect(results[2].data?.body).toEqual({ type: 'result', id: 'pk_atom_2' });
  });

  it('trims trailing \\r (Windows tolerance)', () => {
    const raw = '{"a":1}\r\n';
    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(1);
    expect(results[0].data?.body).toEqual({ a: 1 });
  });

  it('stream without trailing newline — final non-empty line emits as frame', () => {
    const raw = '{"a":1}\n{"b":2}'; // no final \n
    const results = decodeNdjsonStream(raw);
    expect(results).toHaveLength(2);
    expect(results[1].data?.body).toEqual({ b: 2 });
  });

  it('UTF-8 multi-byte round-trip (emoji + CJK)', () => {
    const payload = { emoji: '🎉', cjk: '日本語' };
    const frames: WireFrame<unknown>[] = [{ body: payload }];
    const encoded = encodeNdjsonStream(frames);
    const results = decodeNdjsonStream(encoded);
    expect(results).toHaveLength(1);
    expect(results[0].data?.body).toEqual(payload);
  });

  it('byte offset advances across lines', () => {
    // First line: '1\n' = 2 bytes, so second line offset = 2
    const raw = '1\n\n';
    const results = decodeNdjsonStream(raw);
    expect(results[0].data?.body).toBe(1);
    expect(results[1].error?.offset).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('decodeNdjsonStream property tests', () => {
  it('round-trip property: decode(encode(frames)) returns frame bodies', () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        const encoded = encodeNdjsonStream(frames);
        const results = decodeNdjsonStream(encoded);
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
// decodeNdjsonAsyncIter
// ---------------------------------------------------------------------------

describe('decodeNdjsonAsyncIter', () => {
  it('async iter round-trip: 5 frames with arbitrary chunking', async () => {
    const frames: WireFrame<unknown>[] = [
      { body: { id: 1 } },
      { body: 'hello' },
      { body: null },
      { body: [1, 2, 3] },
      { body: { nested: { deep: true } } },
    ];
    const encoded = encodeNdjsonStream(frames);
    // Split into 3-byte chunks to exercise cross-chunk assembly
    const chunks = chunkedUint8(encoded, 3);
    const results = await collectAsyncIter(decodeNdjsonAsyncIter(toAsyncIter(chunks)));

    expect(results).toHaveLength(5);
    for (let i = 0; i < frames.length; i++) {
      expect(results[i].error).toBeNull();
      expect(results[i].data?.body).toEqual(frames[i].body);
    }
  });

  it('accepts string chunks as well as Uint8Array', async () => {
    // Split `{"a":1}\n{"b":2}\n` across two string chunks mid-second-frame.
    // chunk1 ends before the colon separator: `{"b"` — chunk2 supplies `:2}\n`.
    const chunk1 = '{"a":1}\n{"b"';
    const chunk2 = ':2}\n';
    async function* stringSource(): AsyncIterable<string> {
      yield chunk1;
      yield chunk2;
    }
    const results = await collectAsyncIter(decodeNdjsonAsyncIter(stringSource()));
    expect(results).toHaveLength(2);
    expect(results[0].data?.body).toEqual({ a: 1 });
    expect(results[1].data?.body).toEqual({ b: 2 });
  });

  it('emits malformed_json for stray text mid-stream, other frames still parse', async () => {
    const raw = '{"a":1}\nstray debug text\n{"b":2}\n';
    const chunks = chunkedUint8(raw, 5);
    const results = await collectAsyncIter(decodeNdjsonAsyncIter(toAsyncIter(chunks)));
    expect(results).toHaveLength(3);
    expect(results[0].data?.body).toEqual({ a: 1 });
    expect(results[1].error?.code).toBe('wire/malformed_json');
    expect(results[2].data?.body).toEqual({ b: 2 });
  });

  it('handles a stream that ends without a trailing newline (partial flush)', async () => {
    const raw = '{"a":1}\n{"b":2}'; // no trailing \n
    const chunks = chunkedUint8(raw, 4);
    const results = await collectAsyncIter(decodeNdjsonAsyncIter(toAsyncIter(chunks)));
    expect(results).toHaveLength(2);
    expect(results[1].data?.body).toEqual({ b: 2 });
  });

  it('UTF-8 multi-byte chunks: emoji and CJK round-trip', async () => {
    const payload = { emoji: '🎉', japanese: '日本語' };
    const encoded = encodeNdjsonStream([{ body: payload }]);
    // Tiny 2-byte chunks to split multi-byte sequences across chunks
    const chunks = chunkedUint8(encoded, 2);
    const results = await collectAsyncIter(decodeNdjsonAsyncIter(toAsyncIter(chunks)));
    expect(results).toHaveLength(1);
    expect(results[0].data?.body).toEqual(payload);
  });
});

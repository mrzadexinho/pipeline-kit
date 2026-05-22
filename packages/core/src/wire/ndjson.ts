/**
 * NDJSON wire encoder + decoder.
 *
 * Encoding:
 * - Uses RFC 8785 canonical JSON (sorted keys, no whitespace).
 * - Encodes `frame.body` only. `traceparent` / `tracestate` fields on WireFrame
 *   are ignored by the NDJSON encoder — metadata attachment is handled at the
 *   trace-wire layer (Subunit 1c, `trace-wire.ts`). This asymmetry is per ADR IX-4:
 *   LSP carries trace context in wire headers; NDJSON attaches it out-of-band.
 *
 * Decoding:
 * - Malformed lines surface as `err` frames without poisoning the rest of the stream.
 * - Empty lines are err(`wire/malformed_line`).
 * - JSON parse failures are err(`wire/malformed_json`).
 * - Byte offsets are tracked per line for error reporting.
 */

import { err, ok } from '../result.js';
import { canonicalize } from './canonical-json.js';
import type { WireDecodeFrame, WireFrame } from './types.js';

const TEXT_DECODER = new TextDecoder('utf-8');
const TEXT_ENCODER = new TextEncoder();

/**
 * Encode one frame to a canonical NDJSON line (NO trailing newline).
 * Caller concatenates with `'\n'`.
 *
 * `traceparent`/`tracestate` fields present on the frame are intentionally
 * ignored — they are attached out-of-band at the trace-wire layer (ADR IX-4).
 */
export function encodeNdjsonFrame<T>(frame: WireFrame<T>): string {
  return canonicalize(frame.body);
}

/**
 * Encode N frames; output = `${line1}\n${line2}\n...\n${lineN}\n`
 * (trailing newline after the last frame).
 *
 * `traceparent`/`tracestate` are ignored per ADR IX-4 (see `encodeNdjsonFrame`).
 */
export function encodeNdjsonStream<T>(frames: WireFrame<T>[]): string {
  if (frames.length === 0) return '';
  return `${frames.map((f) => encodeNdjsonFrame(f)).join('\n')}\n`;
}

/**
 * Decode an NDJSON buffer into a sequence of frame results.
 * Malformed lines surface as err frames; well-formed lines continue.
 *
 * - Splits on `\n`.
 * - Drops trailing empty string from a final `\n`.
 * - Trims trailing `\r` per line (Windows tolerance; encoder never emits `\r`).
 * - Empty line → `err({code:'wire/malformed_line'})`.
 * - JSON.parse throw → `err({code:'wire/malformed_json'})`.
 * - Byte offsets are cumulative UTF-8 byte counts to the start of each line.
 */
export function decodeNdjsonStream<T>(raw: string): WireDecodeFrame<T>[] {
  const results: WireDecodeFrame<T>[] = [];
  const rawLines = raw.split('\n');

  // Drop trailing empty string that results from a final '\n'
  const lines =
    rawLines.length > 0 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;

  let byteOffset = 0;
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const lineByteLen = TEXT_ENCODER.encode(`${rawLine}\n`).byteLength;

    if (line.length === 0) {
      results.push(
        err({
          code: 'wire/malformed_line' as const,
          message: 'empty line',
          offset: byteOffset,
          near: '',
        }),
      );
    } else {
      try {
        const parsed = JSON.parse(line) as T;
        results.push(ok({ body: parsed }));
      } catch (e) {
        results.push(
          err({
            code: 'wire/malformed_json' as const,
            message: e instanceof Error ? e.message : String(e),
            offset: byteOffset,
            near: line.slice(0, 64),
          }),
        );
      }
    }

    byteOffset += lineByteLen;
  }

  return results;
}

/**
 * Streaming async-iter decoder.
 *
 * Buffers incoming chunks; emits one WireDecodeFrame per complete `\n`-terminated line.
 * On source end, any non-empty buffer content is emitted as a final frame
 * (JSON.parse succeeds → ok; fails → err(`wire/malformed_json`)).
 * An empty trailing buffer is silently dropped.
 *
 * Accepts `string | Uint8Array` chunks. Uint8Array chunks are UTF-8 decoded.
 */
export async function* decodeNdjsonAsyncIter<T>(
  source: AsyncIterable<string | Uint8Array>,
): AsyncIterable<WireDecodeFrame<T>> {
  let accumulator = '';
  let byteOffset = 0;

  for await (const chunk of source) {
    const text = typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(chunk, { stream: true });
    accumulator += text;

    let newlineIndex = accumulator.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = accumulator.slice(0, newlineIndex);
      accumulator = accumulator.slice(newlineIndex + 1);
      newlineIndex = accumulator.indexOf('\n');

      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      const lineByteLen = TEXT_ENCODER.encode(`${rawLine}\n`).byteLength;

      if (line.length === 0) {
        yield err({
          code: 'wire/malformed_line' as const,
          message: 'empty line',
          offset: byteOffset,
          near: '',
        });
      } else {
        try {
          const parsed = JSON.parse(line) as T;
          yield ok({ body: parsed });
        } catch (e) {
          yield err({
            code: 'wire/malformed_json' as const,
            message: e instanceof Error ? e.message : String(e),
            offset: byteOffset,
            near: line.slice(0, 64),
          });
        }
      }

      byteOffset += lineByteLen;
    }
  }

  // Flush any remaining partial line
  if (accumulator.length > 0) {
    const line = accumulator.endsWith('\r') ? accumulator.slice(0, -1) : accumulator;
    if (line.length === 0) {
      yield err({
        code: 'wire/malformed_line' as const,
        message: 'empty line',
        offset: byteOffset,
        near: '',
      });
    } else {
      try {
        const parsed = JSON.parse(line) as T;
        yield ok({ body: parsed });
      } catch (e) {
        yield err({
          code: 'wire/malformed_json' as const,
          message: e instanceof Error ? e.message : String(e),
          offset: byteOffset,
          near: line.slice(0, 64),
        });
      }
    }
  }
}

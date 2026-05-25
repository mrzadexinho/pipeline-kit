/**
 * LSP async-iter streaming decoder.
 *
 * Exports `decodeLspAsyncIter` — re-exported via lsp-frame.ts barrel.
 */

import { err, ok } from '../result.js';
import { decodeLspStream } from './lsp-frame-decode.js';
import {
  concatUint8,
  findHeaderTerminator,
  HEADER_MAX_BYTES,
  parseFrameHeader,
  parseHeaderLines,
} from './lsp-frame-header.js';
import type { WireDecodeFrame, WireFrame } from './types.js';

const TEXT_DECODER_STRICT = new TextDecoder('utf-8', { fatal: true });

/**
 * Streaming async-iter decoder for LSP frames.
 *
 * Buffers bytes across chunks; emits one frame per parsed header+body pair.
 * Partial bytes are retained in the accumulator across iterations.
 */
export async function* decodeLspAsyncIter<T>(
  source: AsyncIterable<Uint8Array<ArrayBufferLike>>,
): AsyncIterable<WireDecodeFrame<T>> {
  let accumulator: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  for await (const chunk of source) {
    accumulator = concatUint8(accumulator, chunk);

    let pos = 0;
    while (pos < accumulator.byteLength) {
      const terminatorIdx = findHeaderTerminator(accumulator, pos, HEADER_MAX_BYTES);

      if (terminatorIdx === -1) {
        if (accumulator.byteLength - pos >= HEADER_MAX_BYTES) {
          yield err({
            code: 'wire/header_too_large' as const,
            message: `Header block exceeds ${HEADER_MAX_BYTES} byte limit`,
            offset: pos,
          });
          pos = accumulator.byteLength;
        }
        break;
      }

      const headerLines = parseHeaderLines(accumulator, pos, terminatorIdx);
      const headerResult = parseFrameHeader(headerLines, pos);

      if (headerResult.error !== null) {
        yield err(headerResult.error);
        pos = terminatorIdx + 4;
        continue;
      }

      const { contentLength, traceparent, tracestate } = headerResult.data;

      const bodyStart = terminatorIdx + 4;
      if (accumulator.byteLength - bodyStart < contentLength) {
        break;
      }

      const bodyBytes = accumulator.subarray(bodyStart, bodyStart + contentLength);
      pos = bodyStart + contentLength;

      let bodyStr: string;
      try {
        bodyStr = TEXT_DECODER_STRICT.decode(bodyBytes);
      } catch {
        yield err({
          code: 'wire/utf8_invalid' as const,
          message: 'Body bytes are not valid UTF-8',
          offset: bodyStart,
        });
        continue;
      }

      try {
        const parsed = JSON.parse(bodyStr) as T;
        const frame: WireFrame<T> = { body: parsed };
        if (traceparent !== undefined) frame.traceparent = traceparent;
        if (tracestate !== undefined) frame.tracestate = tracestate;
        yield ok(frame);
      } catch (e) {
        yield err({
          code: 'wire/malformed_json' as const,
          message: e instanceof Error ? e.message : String(e),
          offset: bodyStart,
          near: bodyStr.slice(0, 64),
        });
      }
    }

    accumulator = pos < accumulator.byteLength ? accumulator.subarray(pos) : new Uint8Array(0);
  }

  // After source ends, parse remaining bytes
  if (accumulator.byteLength > 0) {
    const remaining = decodeLspStream<T>(accumulator);
    for (const frame of remaining) {
      yield frame;
    }
  }
}

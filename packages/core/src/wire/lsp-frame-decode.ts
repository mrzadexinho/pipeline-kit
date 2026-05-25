/**
 * LSP sync stream decoder.
 *
 * Exports `decodeLspStream` — re-exported via lsp-frame.ts barrel.
 */

import { err, ok } from '../result.js';
import {
  findHeaderTerminator,
  HEADER_MAX_BYTES,
  parseFrameHeader,
  parseHeaderLines,
} from './lsp-frame-header.js';
import type { WireDecodeFrame, WireFrame } from './types.js';

const TEXT_DECODER_STRICT = new TextDecoder('utf-8', { fatal: true });

/**
 * Strict LSP decoder per ADR IX-1.
 *
 * Processes bytes sequentially; emits one WireDecodeFrame per parsed header+body pair.
 * When a decode error occurs for a frame, the error is emitted and parsing advances
 * past what was consumed for that frame attempt (best-effort continuation).
 */
export function decodeLspStream<T>(raw: Uint8Array<ArrayBufferLike>): WireDecodeFrame<T>[] {
  const results: WireDecodeFrame<T>[] = [];
  let pos = 0;

  while (pos < raw.byteLength) {
    const frameStart = pos;

    // Find header terminator within 8 KiB
    const terminatorIdx = findHeaderTerminator(raw, pos, HEADER_MAX_BYTES);

    if (terminatorIdx === -1) {
      const remaining = raw.byteLength - pos;
      if (remaining >= HEADER_MAX_BYTES) {
        results.push(
          err({
            code: 'wire/header_too_large' as const,
            message: `Header block exceeds ${HEADER_MAX_BYTES} byte limit`,
            offset: frameStart,
          }),
        );
      } else {
        const near = new TextDecoder('utf-8').decode(
          raw.subarray(pos, Math.min(pos + 64, raw.byteLength)),
        );
        results.push(
          err({
            code: 'wire/truncated_body' as const,
            message: 'Incomplete header block: stream ended before \\r\\n\\r\\n terminator',
            offset: frameStart,
            near,
          }),
        );
      }
      break;
    }

    // Parse header lines
    const headerLines = parseHeaderLines(raw, pos, terminatorIdx);
    const headerResult = parseFrameHeader(headerLines, frameStart);

    if (headerResult.error !== null) {
      results.push(err(headerResult.error));
      pos = terminatorIdx + 4;
      continue;
    }

    const { contentLength, traceparent, tracestate } = headerResult.data;

    // Advance past header+terminator
    pos = terminatorIdx + 4;

    // Read body bytes
    if (raw.byteLength - pos < contentLength) {
      const near = new TextDecoder('utf-8').decode(
        raw.subarray(pos, Math.min(pos + 64, raw.byteLength)),
      );
      results.push(
        err({
          code: 'wire/truncated_body' as const,
          message: `Expected ${contentLength} body bytes, got ${raw.byteLength - pos}`,
          offset: pos,
          near,
        }),
      );
      break;
    }

    const bodyBytes = raw.subarray(pos, pos + contentLength);
    pos += contentLength;

    // UTF-8 decode (strict)
    let bodyStr: string;
    try {
      bodyStr = TEXT_DECODER_STRICT.decode(bodyBytes);
    } catch {
      results.push(
        err({
          code: 'wire/utf8_invalid' as const,
          message: 'Body bytes are not valid UTF-8',
          offset: pos - contentLength,
        }),
      );
      continue;
    }

    // JSON parse
    try {
      const parsed = JSON.parse(bodyStr) as T;
      const frame: WireFrame<T> = { body: parsed };
      if (traceparent !== undefined) frame.traceparent = traceparent;
      if (tracestate !== undefined) frame.tracestate = tracestate;
      results.push(ok(frame));
    } catch (e) {
      results.push(
        err({
          code: 'wire/malformed_json' as const,
          message: e instanceof Error ? e.message : String(e),
          offset: pos - contentLength,
          near: bodyStr.slice(0, 64),
        }),
      );
    }
  }

  return results;
}

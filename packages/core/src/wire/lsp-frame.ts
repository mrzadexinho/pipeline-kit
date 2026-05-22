/**
 * LSP Content-Length wire framer (strict decoder per ADR IX-1).
 *
 * Frame format:
 *   Content-Length: N\r\n
 *   [traceparent: <value>\r\n]
 *   [tracestate: <value>\r\n]
 *   \r\n
 *   <N UTF-8 body bytes>
 *
 * Decoder is STRICT:
 * - First header line MUST be `Content-Length: N` (case-insensitive key).
 *   Any other first-line content (including stray print() output) -> wire/unknown_header.
 * - Subsequent header lines: only `traceparent` and `tracestate` permitted.
 * - Header block bounded at 8 KiB; exceeding -> wire/header_too_large.
 * - Body byte length MUST equal Content-Length value; under-reads -> wire/truncated_body.
 * - UTF-8 encoding enforced via TextDecoder(fatal:true) -> wire/utf8_invalid on bad bytes.
 *
 * Encoder honors `frame.traceparent` / `frame.tracestate` when present (LSP can carry
 * trace context in wire headers per ADR IX-4). NDJSON encoder deliberately ignores
 * these fields -- see ndjson.ts.
 */

import { err, ok } from '../result.js';
import { canonicalize } from './canonical-json.js';
import type { WireDecodeFrame, WireFrame } from './types.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER_STRICT = new TextDecoder('utf-8', { fatal: true });

const HEADER_MAX_BYTES = 8192;
const CRLF = '\r\n';

/** Concatenate two Uint8Arrays into one. */
function concatUint8(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/**
 * Find the index of the CRLF+CRLF terminator in a Uint8Array.
 * Returns -1 if not found within `limit` bytes from `start`.
 */
function findHeaderTerminator(
  buf: Uint8Array<ArrayBufferLike>,
  start: number,
  limit: number,
): number {
  const end = Math.min(buf.byteLength - 3, start + limit - 3);
  for (let i = start; i <= end; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

/** Parse the header block (between `start` and `terminatorIdx`) into header lines. */
function parseHeaderLines(
  buf: Uint8Array<ArrayBufferLike>,
  start: number,
  terminatorIdx: number,
): string[] {
  const headerBlockBytes = buf.subarray(start, terminatorIdx);
  const headerBlock = new TextDecoder('utf-8').decode(headerBlockBytes);
  return headerBlock.split(CRLF).filter((l) => l.length > 0);
}

/**
 * Encode a single frame to LSP
 * `Content-Length: N\r\n[traceparent: ...\r\n][tracestate: ...\r\n]\r\n<body>`.
 * UTF-8 byte-count is enforced (not char-count).
 *
 * If `frame.traceparent` is present it is emitted as a header line before the blank line.
 * If `frame.tracestate` is present (requires `traceparent`) it follows.
 */
export function encodeLspFrame<T>(frame: WireFrame<T>): Uint8Array {
  const body = canonicalize(frame.body);
  const bodyBytes = TEXT_ENCODER.encode(body);

  let headerStr = `Content-Length: ${bodyBytes.byteLength}${CRLF}`;
  if (frame.traceparent !== undefined) {
    headerStr += `traceparent: ${frame.traceparent}${CRLF}`;
    if (frame.tracestate !== undefined) {
      headerStr += `tracestate: ${frame.tracestate}${CRLF}`;
    }
  }
  headerStr += CRLF;

  const headerBytes = TEXT_ENCODER.encode(headerStr);
  return concatUint8(headerBytes, bodyBytes);
}

/**
 * Encode N frames; concatenated bytes; no separator between frames.
 */
export function encodeLspStream<T>(frames: WireFrame<T>[]): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0);
  let result: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  for (const frame of frames) {
    result = concatUint8(result, encodeLspFrame(frame));
  }
  return result;
}

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

    if (headerLines.length === 0) {
      results.push(
        err({
          code: 'wire/unknown_header' as const,
          message: 'Empty header block',
          offset: frameStart,
          near: '',
        }),
      );
      pos = terminatorIdx + 4;
      continue;
    }

    // First line MUST be Content-Length
    const firstLine = headerLines[0] ?? '';
    const contentLengthMatch = /^Content-Length:\s*(\d+)\s*$/i.exec(firstLine);

    if (!contentLengthMatch) {
      const near = firstLine.slice(0, 64);
      results.push(
        err({
          code: 'wire/unknown_header' as const,
          message: `First header line is not Content-Length: ${near}`,
          offset: frameStart,
          near,
        }),
      );
      pos = terminatorIdx + 4;
      continue;
    }

    const clValue = contentLengthMatch[1] ?? '';
    const contentLength = parseInt(clValue, 10);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      results.push(
        err({
          code: 'wire/content_length_invalid' as const,
          message: `Invalid Content-Length value: ${clValue}`,
          offset: frameStart,
        }),
      );
      pos = terminatorIdx + 4;
      continue;
    }

    // Validate subsequent header lines (only traceparent/tracestate allowed)
    let traceparent: string | undefined;
    let tracestate: string | undefined;
    let headerError = false;

    for (let i = 1; i < headerLines.length; i++) {
      const line = headerLines[i] ?? '';
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) {
        results.push(
          err({
            code: 'wire/unknown_header' as const,
            message: `Malformed header line: ${line.slice(0, 64)}`,
            offset: frameStart,
            near: line.slice(0, 64),
          }),
        );
        headerError = true;
        break;
      }
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      if (key === 'traceparent') {
        traceparent = value;
      } else if (key === 'tracestate') {
        tracestate = value;
      } else {
        results.push(
          err({
            code: 'wire/unknown_header' as const,
            message: `Unknown header key: ${key}`,
            offset: frameStart,
            near: line.slice(0, 64),
          }),
        );
        headerError = true;
        break;
      }
    }

    if (headerError) {
      pos = terminatorIdx + 4;
      continue;
    }

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

      if (headerLines.length === 0) {
        yield err({
          code: 'wire/unknown_header' as const,
          message: 'Empty header block',
          offset: pos,
          near: '',
        });
        pos = terminatorIdx + 4;
        continue;
      }

      const firstLine = headerLines[0] ?? '';
      const contentLengthMatch = /^Content-Length:\s*(\d+)\s*$/i.exec(firstLine);

      if (!contentLengthMatch) {
        const near = firstLine.slice(0, 64);
        yield err({
          code: 'wire/unknown_header' as const,
          message: `First header line is not Content-Length: ${near}`,
          offset: pos,
          near,
        });
        pos = terminatorIdx + 4;
        continue;
      }

      const clValue = contentLengthMatch[1] ?? '';
      const contentLength = parseInt(clValue, 10);
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        yield err({
          code: 'wire/content_length_invalid' as const,
          message: `Invalid Content-Length value: ${clValue}`,
          offset: pos,
        });
        pos = terminatorIdx + 4;
        continue;
      }

      // Validate additional headers
      let traceparent: string | undefined;
      let tracestate: string | undefined;
      let headerError = false;

      for (let i = 1; i < headerLines.length; i++) {
        const line = headerLines[i] ?? '';
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
          yield err({
            code: 'wire/unknown_header' as const,
            message: `Malformed header line: ${line.slice(0, 64)}`,
            offset: pos,
            near: line.slice(0, 64),
          });
          headerError = true;
          break;
        }
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (key === 'traceparent') {
          traceparent = value;
        } else if (key === 'tracestate') {
          tracestate = value;
        } else {
          yield err({
            code: 'wire/unknown_header' as const,
            message: `Unknown header key: ${key}`,
            offset: pos,
            near: line.slice(0, 64),
          });
          headerError = true;
          break;
        }
      }

      if (headerError) {
        pos = terminatorIdx + 4;
        continue;
      }

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

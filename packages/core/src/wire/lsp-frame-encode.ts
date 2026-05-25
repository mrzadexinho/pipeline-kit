/**
 * LSP frame encoder.
 *
 * Exports `encodeLspFrame` and `encodeLspStream` — re-exported via lsp-frame.ts barrel.
 */

import { canonicalize } from './canonical-json.js';
import { CRLF, concatUint8 } from './lsp-frame-header.js';
import type { WireFrame } from './types.js';

const TEXT_ENCODER = new TextEncoder();

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

/**
 * Shared header parsing helpers for the LSP wire framer.
 *
 * Internal module — imported by lsp-frame-encode.ts, lsp-frame-decode.ts, and
 * lsp-frame-async.ts. Not re-exported via the lsp-frame.ts barrel.
 */

import type { Result } from '../result.js';
import { err, ok } from '../result.js';
import type { WireDecodeError } from './types.js';

export const HEADER_MAX_BYTES = 8192;
export const CRLF = '\r\n';

/** Concatenate two Uint8Arrays into one. */
export function concatUint8(
  a: Uint8Array<ArrayBufferLike>,
  b: Uint8Array<ArrayBufferLike>,
): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/**
 * Find the index of the CRLF+CRLF terminator in a Uint8Array.
 * Returns -1 if not found within `limit` bytes from `start`.
 */
export function findHeaderTerminator(
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
export function parseHeaderLines(
  buf: Uint8Array<ArrayBufferLike>,
  start: number,
  terminatorIdx: number,
): string[] {
  const headerBlockBytes = buf.subarray(start, terminatorIdx);
  const headerBlock = new TextDecoder('utf-8').decode(headerBlockBytes);
  return headerBlock.split(CRLF).filter((l) => l.length > 0);
}

/** Parsed header fields extracted from a valid LSP header block. */
export interface ParsedFrameHeader {
  contentLength: number;
  traceparent?: string;
  tracestate?: string;
}

/**
 * Parse and validate a complete LSP header block, deduplicating the validation
 * logic shared by the sync and async decoders.
 *
 * Returns `ok(ParsedFrameHeader)` on success or `err(DecodeError)` on any
 * header violation. Error codes, messages, and offsets are byte-identical to
 * the inline logic previously duplicated in both decoders.
 *
 * @param headerLines - result of `parseHeaderLines` for the current frame
 * @param frameStart  - byte offset of the start of this frame (for error reporting)
 */
export function parseFrameHeader(
  headerLines: string[],
  frameStart: number,
): Result<ParsedFrameHeader, WireDecodeError> {
  if (headerLines.length === 0) {
    return err({
      code: 'wire/unknown_header' as const,
      message: 'Empty header block',
      offset: frameStart,
      near: '',
    });
  }

  // First line MUST be Content-Length
  const firstLine = headerLines[0] ?? '';
  const contentLengthMatch = /^Content-Length:\s*(\d+)\s*$/i.exec(firstLine);

  if (!contentLengthMatch) {
    const near = firstLine.slice(0, 64);
    return err({
      code: 'wire/unknown_header' as const,
      message: `First header line is not Content-Length: ${near}`,
      offset: frameStart,
      near,
    });
  }

  const clValue = contentLengthMatch[1] ?? '';
  const contentLength = parseInt(clValue, 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return err({
      code: 'wire/content_length_invalid' as const,
      message: `Invalid Content-Length value: ${clValue}`,
      offset: frameStart,
    });
  }

  // Validate subsequent header lines (only traceparent/tracestate allowed)
  let traceparent: string | undefined;
  let tracestate: string | undefined;

  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i] ?? '';
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      return err({
        code: 'wire/unknown_header' as const,
        message: `Malformed header line: ${line.slice(0, 64)}`,
        offset: frameStart,
        near: line.slice(0, 64),
      });
    }
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'traceparent') {
      traceparent = value;
    } else if (key === 'tracestate') {
      tracestate = value;
    } else {
      return err({
        code: 'wire/unknown_header' as const,
        message: `Unknown header key: ${key}`,
        offset: frameStart,
        near: line.slice(0, 64),
      });
    }
  }

  return ok({ contentLength, traceparent, tracestate });
}

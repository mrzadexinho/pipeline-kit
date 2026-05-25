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
 *
 * Sub-modules:
 *   lsp-frame-header.ts   — shared constants + header parsing helpers
 *   lsp-frame-encode.ts   — encodeLspFrame, encodeLspStream
 *   lsp-frame-decode.ts   — decodeLspStream (sync)
 *   lsp-frame-async.ts    — decodeLspAsyncIter (async-iter)
 */

export { decodeLspAsyncIter } from './lsp-frame-async.js';
export { decodeLspStream } from './lsp-frame-decode.js';
export { encodeLspFrame, encodeLspStream } from './lsp-frame-encode.js';

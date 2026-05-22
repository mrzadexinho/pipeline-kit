// Wire-tier foundation exports — Subunit 1a + 1b + 1c

export { canonicalize, canonicalizeRaw } from './canonical-json.js';
export type { DecodedResult } from './decode-result.js';
export { decodeResult } from './decode-result.js';
export {
  decodeLspAsyncIter,
  decodeLspStream,
  encodeLspFrame,
  encodeLspStream,
} from './lsp-frame.js';
export {
  decodeNdjsonAsyncIter,
  decodeNdjsonStream,
  encodeNdjsonFrame,
  encodeNdjsonStream,
} from './ndjson.js';
export { encodeTimestamp, validateTimestamp } from './timestamp.js';
export { attachTraceToFrame, extractTraceFromFrame } from './trace-wire.js';
export type {
  WireDecodeError,
  WireDecodeErrorCode,
  WireDecodeFrame,
  WireFrame,
  WireMode,
} from './types.js';

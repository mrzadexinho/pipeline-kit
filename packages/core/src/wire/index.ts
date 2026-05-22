// Wire-tier foundation exports — Subunit 1a
// TODO: ndjson, lsp-frame, and trace-wire re-exports arrive in Subunit 1b/1c.

export { canonicalize, canonicalizeRaw } from './canonical-json.js';
export type { DecodedResult } from './decode-result.js';
export { decodeResult } from './decode-result.js';
export { encodeTimestamp, validateTimestamp } from './timestamp.js';
export type {
  WireDecodeError,
  WireDecodeErrorCode,
  WireDecodeFrame,
  WireFrame,
  WireMode,
} from './types.js';

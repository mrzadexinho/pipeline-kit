import type { Result } from '../result.js';

export type WireMode = 'ndjson' | 'lsp';

export interface WireFrame<T = unknown> {
  body: T;
  /** Out-of-band W3C trace context per ADR IX-4. */
  traceparent?: string;
  tracestate?: string;
}

export type WireDecodeErrorCode =
  | 'wire/malformed_line'
  | 'wire/malformed_json'
  | 'wire/truncated_body'
  | 'wire/unknown_header'
  | 'wire/content_length_invalid'
  | 'wire/content_length_missing'
  | 'wire/header_too_large'
  | 'wire/result_ambiguous'
  | 'wire/timestamp_sub_ms_precision'
  | 'wire/timestamp_format_invalid'
  | 'wire/integer_unsafe'
  | 'wire/utf8_invalid';

export interface WireDecodeError {
  code: WireDecodeErrorCode;
  message: string;
  /** Byte offset in stream when relevant (LSP frame parse errors). */
  offset?: number;
  /** Original raw bytes/text near the error site (truncated to <= 64 chars). */
  near?: string;
}

export type WireDecodeFrame<T> = Result<WireFrame<T>, WireDecodeError>;

import { type Context, trace } from '@opentelemetry/api';

// W3C Trace Context — out-of-band NDJSON frame envelope (ADR IX-4).
// Child processes do NOT need OTel SDK; they just forward these strings.

export interface WireTraceContext {
  /** W3C traceparent: 00-<32hex>-<16hex>-<2hex> */
  traceparent: string;
  /** Optional W3C tracestate */
  tracestate?: string;
}

export interface NDJSONFrame<T> {
  trace?: WireTraceContext;
  payload: T;
}

// Regex: lowercase hex only, exact section lengths.
const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const ALL_ZEROS_32 = '0'.repeat(32);
const ALL_ZEROS_16 = '0'.repeat(16);

/**
 * Parse and validate a W3C traceparent string.
 * Returns undefined for any malformed or invalid input.
 */
export function parseTraceContext(input: unknown): WireTraceContext | undefined {
  if (typeof input !== 'object' || input === null) return undefined;

  const obj = input as Record<string, unknown>;
  const traceparent = obj.traceparent;
  if (typeof traceparent !== 'string') return undefined;
  if (!TRACEPARENT_RE.test(traceparent)) return undefined;

  // Validate trace-id and span-id are not all zeros.
  const parts = traceparent.split('-');
  // parts: [version, traceId, spanId, flags]
  if (parts.length !== 4) return undefined;
  const traceId = parts[1];
  const spanId = parts[2];
  if (traceId === ALL_ZEROS_32) return undefined;
  if (spanId === ALL_ZEROS_16) return undefined;

  const result: WireTraceContext = { traceparent };

  const tracestate = obj.tracestate;
  if (typeof tracestate === 'string') {
    result.tracestate = tracestate;
  }

  return result;
}

/**
 * Serialize the active OTel span context into a WireTraceContext.
 * Returns undefined when there is no active span or the span context is invalid.
 */
export function serializeTraceContext(otelContext: Context): WireTraceContext | undefined {
  const spanContext = trace.getSpanContext(otelContext);
  if (spanContext === undefined) return undefined;

  const { traceId, spanId, traceFlags, traceState } = spanContext;

  // Validate: not all zeros.
  if (traceId === ALL_ZEROS_32 || spanId === ALL_ZEROS_16) return undefined;

  const flagHex = traceFlags.toString(16).padStart(2, '0');
  const traceparent = `00-${traceId}-${spanId}-${flagHex}`;

  const result: WireTraceContext = { traceparent };

  const serializedState = traceState?.serialize();
  if (serializedState !== undefined && serializedState !== '') {
    result.tracestate = serializedState;
  }

  return result;
}

/** Wrap a JSON payload with optional trace context into an NDJSONFrame. */
export function wrapFrame<T>(payload: T, trace?: WireTraceContext): NDJSONFrame<T> {
  if (trace !== undefined) {
    return { trace, payload };
  }
  return { payload };
}

/** Unwrap an NDJSONFrame into its trace context and payload. */
export function unwrapFrame<T>(frame: NDJSONFrame<T>): { trace?: WireTraceContext; payload: T } {
  return { trace: frame.trace, payload: frame.payload };
}

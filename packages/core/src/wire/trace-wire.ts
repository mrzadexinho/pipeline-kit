import type { SerializableContext } from '../serializable-context.js';
import type { WireFrame } from './types.js';

/**
 * Guard: returns true when `v` is a non-null, non-array plain object
 * that has a `metadata` property which is itself a non-null, non-array
 * plain object.
 *
 * This heuristic lets `attachTraceToFrame` inject trace context into
 * `body.metadata` for NDJSON frames (ADR IX-4). NDJSON encoder serialises
 * `frame.body` only, so trace must live inside the body to survive the wire.
 */
function isRecordWithMetadata(
  v: unknown,
): v is Record<string, unknown> & { metadata: Record<string, unknown> } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  const meta = obj.metadata;
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta);
}

/**
 * Attach W3C trace context to a wire frame (ADR IX-4, both wire modes).
 *
 * Two-form attachment so the trace survives both wire-mode codec choices:
 * 1. Sets `frame.traceparent` / `frame.tracestate` — used by LSP encoder
 *    (`encodeLspFrame`) which emits them as header lines.
 * 2. If `frame.body` is an object with a `metadata` field (record-shaped),
 *    injects `body.metadata.traceparent` / `body.metadata.tracestate` — this
 *    is what survives NDJSON encoding (since NDJSON ignores the WireFrame
 *    envelope fields and only serializes `frame.body`).
 *
 * Returns a NEW frame (does not mutate the input).
 *
 * If `ctx.trace.traceparent` is empty string, NO attachment happens (treat
 * empty traceparent as "no trace to propagate" per the existing
 * `extractWireContext` convention in `../serializable-context.ts`).
 */
export function attachTraceToFrame<T>(frame: WireFrame<T>, ctx: SerializableContext): WireFrame<T> {
  const { traceparent, tracestate } = ctx.trace;

  // No-op for empty traceparent — convention from extractWireContext
  if (traceparent === '') return frame;

  // Build new envelope-level fields
  const envelopeFields: Pick<WireFrame<T>, 'traceparent' | 'tracestate'> = { traceparent };
  if (tracestate !== undefined) {
    envelopeFields.tracestate = tracestate;
  }

  // NDJSON path: inject into a shallow-copied body.metadata (if record-shaped)
  let newBody: T = frame.body;
  if (isRecordWithMetadata(frame.body)) {
    const oldMeta = frame.body.metadata as Record<string, unknown>;
    const newMeta: Record<string, unknown> = {
      ...oldMeta,
      traceparent,
      ...(tracestate !== undefined ? { tracestate } : {}),
    };
    newBody = { ...frame.body, metadata: newMeta } as T;
  }

  return { ...frame, body: newBody, ...envelopeFields };
}

/**
 * Extract W3C trace context from a wire frame. Inverse of `attachTraceToFrame`.
 *
 * Lookup order:
 * 1. `frame.traceparent` (LSP form, post-decode).
 * 2. `frame.body.metadata.traceparent` if body is record-shaped (NDJSON form, post-decode).
 *
 * Returns `{ traceparent, tracestate? }` if found, else `null`.
 *
 * Both `traceparent` and `tracestate` must be strings; non-string values
 * are treated as a lookup miss.
 */
export function extractTraceFromFrame<T>(frame: WireFrame<T>): SerializableContext['trace'] | null {
  // Priority 1: LSP envelope form
  if (typeof frame.traceparent === 'string' && frame.traceparent !== '') {
    const result: SerializableContext['trace'] = { traceparent: frame.traceparent };
    if (typeof frame.tracestate === 'string') {
      result.tracestate = frame.tracestate;
    }
    return result;
  }

  // Priority 2: NDJSON body.metadata form
  if (isRecordWithMetadata(frame.body)) {
    const meta = frame.body.metadata as Record<string, unknown>;
    const tp = meta.traceparent;
    if (typeof tp === 'string' && tp !== '') {
      const result: SerializableContext['trace'] = { traceparent: tp };
      const ts = meta.tracestate;
      if (typeof ts === 'string') {
        result.tracestate = ts;
      }
      return result;
    }
  }

  return null;
}

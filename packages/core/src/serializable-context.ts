import { ROOT_CONTEXT, propagation } from '@opentelemetry/api';
import type { PipelineContext, TraceContext } from './context.js';

/**
 * The ONLY context subset that crosses the TS→Python wire (VI-5, IX-4).
 * Excluded: signal (runtime object), deps (adapter refs), metadata (PII), attempt (Python does not own retries).
 */
export interface SerializableContext {
  runId: string;
  trace: { traceparent: string; tracestate?: string };
  idempotencyKey: string;
}

type WireCarrier = Record<string, string>;

/** Extract W3C trace strings from an OTel Context using the globally registered propagator. */
function injectToCarrier(traceCtx: TraceContext): WireCarrier {
  const carrier: WireCarrier = {};
  propagation.inject(traceCtx, carrier);
  return carrier;
}

/**
 * Extract wire-serialisable context from a PipelineContext.
 * Requires a W3CTraceContextPropagator (or compatible) registered globally;
 * without one, `trace.traceparent` will be an empty string.
 */
export function extractWireContext(ctx: PipelineContext): SerializableContext {
  const carrier = injectToCarrier(ctx.trace);
  return {
    runId: ctx.runId,
    trace: {
      traceparent: carrier['traceparent'] ?? '',
      ...(carrier['tracestate'] !== undefined ? { tracestate: carrier['tracestate'] } : {}),
    },
    idempotencyKey: ctx.idempotencyKey ?? '',
  };
}

/**
 * Inject wire context back into a PipelineContext, restoring the OTel trace.
 * Returns a new PipelineContext with the trace replaced by the extracted OTel Context.
 */
export function injectWireContext(
  wireCtx: SerializableContext,
  ctx: PipelineContext,
): PipelineContext {
  const carrier: WireCarrier = { traceparent: wireCtx.trace.traceparent };
  if (wireCtx.trace.tracestate !== undefined) {
    carrier['tracestate'] = wireCtx.trace.tracestate;
  }
  const restoredTrace = propagation.extract(ROOT_CONTEXT, carrier);

  return {
    get runId() {
      return ctx.runId;
    },
    get pipelineId() {
      return ctx.pipelineId;
    },
    get attempt() {
      return ctx.attempt;
    },
    get metadata() {
      return ctx.metadata;
    },
    get signal() {
      return ctx.signal;
    },
    get trace() {
      return restoredTrace;
    },
    idempotencyKey: wireCtx.idempotencyKey || ctx.idempotencyKey,
    get memory() {
      return ctx.memory;
    },
    get deps() {
      return ctx.deps;
    },
    get usage() {
      return ctx.usage;
    },
    attachMetadata(key, value) {
      ctx.attachMetadata(key, value);
    },
  };
}

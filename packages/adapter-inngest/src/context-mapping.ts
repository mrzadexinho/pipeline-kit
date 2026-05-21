import type { PipelineContext } from '@idriszade/core';
import { createUsageAccumulator } from '@idriszade/core';
import { propagation, ROOT_CONTEXT } from '@opentelemetry/api';

/**
 * Minimal shape of the Inngest event object relevant to context mapping.
 * `attempt` is 0-indexed (first run = 0).
 * `data` may carry W3C trace propagation headers per ADR IX-4.
 */
export interface InngestEventContext {
  attempt: number;
  data?: Record<string, unknown>;
}

export interface MapContextOptions {
  runId: string;
  pipelineId: string;
  deps?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Unwrap a kitFanOut child event data envelope.
 *
 * When a parent uses kitFanOut, it wraps each child's payload as
 * `{ _pk_trace: Record<string, string>, payload: T }` (ADR III-2).
 * This helper detects that shape and returns the inner payload + trace carrier.
 * If the envelope shape is absent, the original data is returned as-is.
 */
export function unwrapFanOutEnvelope(data: Record<string, unknown> | undefined): {
  payload: Record<string, unknown> | undefined;
  traceCarrier: Record<string, string> | undefined;
} {
  if (
    data !== undefined &&
    typeof data._pk_trace === 'object' &&
    data._pk_trace !== null &&
    'payload' in data
  ) {
    const carrier = data._pk_trace as Record<string, string>;
    const payload = data.payload as Record<string, unknown> | undefined;
    return { payload, traceCarrier: carrier };
  }
  return { payload: data, traceCarrier: undefined };
}

/**
 * Map an Inngest event + options to a pipeline-kit PipelineContext.
 *
 * Trace propagation (ADR III-2):
 * 1. If `event.data._pk_trace` is present (kitFanOut child envelope), extract
 *    the W3C trace carrier from that object and populate RunOptions.parentTraceContext.
 * 2. Fallback: if `event.data.traceparent` is present (legacy flat shape), use it.
 * 3. Without either, falls back to ROOT_CONTEXT.
 *
 * The function also unwraps the fan-out payload so child handlers see the
 * original item shape rather than the `{ _pk_trace, payload }` wrapper.
 */
export function mapInngestContext(
  event: InngestEventContext,
  opts: MapContextOptions,
): PipelineContext {
  const controller = new AbortController();

  // Detect and unwrap kitFanOut envelope; extract trace carrier.
  const { traceCarrier } = unwrapFanOutEnvelope(event.data);

  // Restore OTel trace: prefer _pk_trace carrier, fallback to flat traceparent.
  let trace = ROOT_CONTEXT;
  if (traceCarrier !== undefined) {
    trace = propagation.extract(ROOT_CONTEXT, traceCarrier);
  } else if (typeof event.data?.traceparent === 'string') {
    const carrier: Record<string, string> = {
      traceparent: event.data.traceparent,
    };
    if (typeof event.data?.tracestate === 'string') {
      carrier.tracestate = event.data.tracestate;
    }
    trace = propagation.extract(ROOT_CONTEXT, carrier);
  }

  const internalMetadata: Record<string, unknown> = {};
  const frozenDeps = Object.freeze({ ...(opts.deps ?? {}) });

  return {
    runId: opts.runId,
    pipelineId: opts.pipelineId,
    attempt: event.attempt,
    signal: controller.signal,
    trace,
    idempotencyKey: opts.idempotencyKey,
    deps: frozenDeps,
    usage: createUsageAccumulator(),
    get metadata(): Readonly<Record<string, unknown>> {
      return internalMetadata;
    },
    attachMetadata(key: string, value: unknown): void {
      internalMetadata[key] = value;
    },
  };
}

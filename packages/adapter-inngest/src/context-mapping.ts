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
 * Map an Inngest event + options to a pipeline-kit PipelineContext.
 *
 * Trace propagation: if `event.data.traceparent` is present, it is extracted
 * via the globally registered OTel propagator (W3CTraceContextPropagator or
 * compatible). Without one registered, the trace falls back to ROOT_CONTEXT.
 */
export function mapInngestContext(
  event: InngestEventContext,
  opts: MapContextOptions,
): PipelineContext {
  const controller = new AbortController();

  // Restore OTel trace from W3C traceparent / tracestate carried in event.data.
  let trace = ROOT_CONTEXT;
  if (typeof event.data?.traceparent === 'string') {
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

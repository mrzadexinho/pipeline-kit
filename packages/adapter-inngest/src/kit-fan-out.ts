import type { Result, StageError } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import { context, type Context as OtelContext, propagation } from '@opentelemetry/api';
import type { StepTools } from './create-kit-function.js';

export interface FanOutOptions<T> {
  childFunction: unknown; // InngestFunction reference (opaque to kit)
  items: T[];
  sourceId?: string; // step id for source memoization, default "fan-out-source"
  /**
   * OTel context to propagate into child invocations (ADR III-2).
   *
   * Pass the parent pipeline's `ctx.trace` here so the W3C traceparent is
   * injected into each child's `_pk_trace` envelope. When omitted, falls back
   * to `context.active()` which is correct in Inngest's runtime environment
   * (AsyncLocalStorage wired) but may be root context in test environments.
   */
  traceContext?: OtelContext;
}

/**
 * Fan-out helper that invokes each item as a separate Inngest child function
 * in parallel, returning a per-item Result array (ADRs IV-1, IV-7).
 *
 * - Memoizes the items array via step.run for replay-safety (ADR I-6).
 * - Uses step.invoke() per item (NOT step.run) for per-child durability.
 * - Per-invoke failures are caught and returned as Result.err; never rethrown.
 * - Injects W3C trace context under `_pk_trace` key in each child data envelope (ADR III-2).
 */
export async function kitFanOut<T, O>(
  step: StepTools,
  opts: FanOutOptions<T>,
): Promise<Array<Result<O, StageError>>> {
  // Step 1: Memoize source for replay-safety (I-6)
  const items = await step.run(opts.sourceId ?? 'fan-out-source', () => opts.items);

  // Step 2: Inject W3C trace context into each child invocation envelope (ADR III-2).
  // Prefer opts.traceContext (explicit) over context.active() (works in Inngest runtime
  // where AsyncLocalStorage is properly wired; may be ROOT_CONTEXT in tests).
  const sourceCtx = opts.traceContext ?? context.active();
  const carrier: Record<string, string> = {};
  propagation.inject(sourceCtx, carrier);

  // Step 3: Invoke each item as a child function in parallel.
  // Payload shape: { _pk_trace: carrier, payload: item } — carrier is the W3C trace envelope.
  const results = await Promise.all(
    items.map(async (item, index): Promise<Result<O, StageError>> => {
      try {
        const output = await step.invoke(`fan-out-${index}`, {
          function: opts.childFunction,
          data: { _pk_trace: carrier, payload: item },
        });
        return ok(output as O);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err({
          type: 'stage_error',
          code: 'process_failed' as const,
          message: `Fan-out child ${index} failed: ${message}`,
        });
      }
    }),
  );

  return results;
}

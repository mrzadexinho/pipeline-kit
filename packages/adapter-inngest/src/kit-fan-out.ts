import type { Result, StageError } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { StepTools } from './create-kit-function.js';

export interface FanOutOptions<T> {
  childFunction: unknown; // InngestFunction reference (opaque to kit)
  items: T[];
  sourceId?: string; // step id for source memoization, default "fan-out-source"
}

/**
 * Fan-out helper that invokes each item as a separate Inngest child function
 * in parallel, returning a per-item Result array (ADRs IV-1, IV-7).
 *
 * - Memoizes the items array via step.run for replay-safety (ADR I-6).
 * - Uses step.invoke() per item (NOT step.run) for per-child durability.
 * - Per-invoke failures are caught and returned as Result.err; never rethrown.
 */
export async function kitFanOut<T, O>(
  step: StepTools,
  opts: FanOutOptions<T>,
): Promise<Array<Result<O, StageError>>> {
  // Step 1: Memoize source for replay-safety (I-6)
  const items = await step.run(opts.sourceId ?? 'fan-out-source', () => opts.items);

  // Step 2: Invoke each item as a child function in parallel
  const results = await Promise.all(
    items.map(async (item, index): Promise<Result<O, StageError>> => {
      try {
        const output = await step.invoke(`fan-out-${index}`, {
          function: opts.childFunction,
          data: item,
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

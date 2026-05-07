import type { RunError } from '../errors/run.js';
import { err, type Result } from '../result.js';

export const CANCELLED_RUN_ERROR: RunError = {
  type: 'cancelled',
  code: 'pipeline_cancelled',
  message: 'Pipeline run was aborted via AbortSignal',
};

export function cancelledResult(): Result<never, RunError> {
  return err(CANCELLED_RUN_ERROR);
}

export function isCancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export function combineSignals(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const filtered = signals.filter((s): s is AbortSignal => s !== undefined);
  if (filtered.length === 0) return new AbortController().signal;
  if (filtered.length === 1) {
    const only = filtered[0];
    if (only !== undefined) return only;
  }
  return AbortSignal.any(filtered);
}

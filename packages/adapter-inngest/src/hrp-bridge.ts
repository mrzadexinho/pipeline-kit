import { NonRetriableError } from 'inngest';
import type { StepTools } from './create-kit-function.js';

export type TimeoutPolicy = 'continue' | 'error';

export interface HrpCheckpointOptions {
  runId: string;
  timeout: string; // Inngest duration string, e.g. "1h", "30m"
  timeoutPolicy?: TimeoutPolicy; // default: 'continue'
  sendReviewRequest?: (runId: string) => Promise<void>; // custom webhook sender
}

export interface HrpCheckpointResult {
  approved: boolean;
  reviewer?: string;
  timedOut: boolean;
}

/**
 * Bridges pipeline-kit's Reviewable/HRP checkpoint to Inngest's step.waitForEvent.
 *
 * 1. Sends a review request via step.run("hrp-send-review-request", ...) — durable, replay-safe.
 * 2. Waits for approval via step.waitForEvent("hrp-wait-review", ...) matching data.runId.
 * 3. On timeout: applies timeoutPolicy — 'continue' returns approved=false, 'error' throws NonRetriableError.
 *
 * ADR I-5: HRP checkpoint maps to Inngest waitForEvent.
 */
export async function createHrpCheckpoint(
  step: StepTools,
  opts: HrpCheckpointOptions,
): Promise<HrpCheckpointResult> {
  // Step 1: Send review request (durable — replays on retry)
  if (opts.sendReviewRequest) {
    await step.run('hrp-send-review-request', async () => {
      await opts.sendReviewRequest!(opts.runId);
    });
  }

  // Step 2: Wait for review event
  const reviewEvent = await step.waitForEvent('hrp-wait-review', {
    event: 'hrp/review.completed',
    timeout: opts.timeout,
    match: 'data.runId',
  });

  // Step 3: Handle result
  if (reviewEvent === null) {
    // Timeout
    const policy = opts.timeoutPolicy ?? 'continue';
    if (policy === 'error') {
      throw new NonRetriableError(`HRP review timed out for run ${opts.runId}`);
    }
    return { approved: false, timedOut: true };
  }

  // Review completed
  const data = (reviewEvent as Record<string, unknown>).data as
    | Record<string, unknown>
    | undefined;
  return {
    approved: Boolean(data?.approved),
    reviewer: typeof data?.reviewer === 'string' ? data.reviewer : undefined,
    timedOut: false,
  };
}

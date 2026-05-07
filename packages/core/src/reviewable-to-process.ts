import type { ProcessError } from './errors/process.js';
import { proc } from './ids.js';
import { err, ok, type Result } from './result.js';
import type { Reviewable, ReviewResponse } from './reviewable.js';
import type { Process } from './stages/process.js';

export function reviewableToProcess<I>(reviewable: Reviewable<I>): Process<I, I> {
  return {
    id: proc(),
    async run(input: I, ctx): Promise<Result<I, ProcessError>> {
      const reviewResult = await reviewable.review(input, ctx);
      if (reviewResult.error !== null) {
        return err({
          type: 'process',
          code: 'review_failed',
          message: reviewResult.error.message,
          reason: reviewResult.error.type,
        });
      }

      const responses = reviewResult.data;
      if (responses.length === 0) {
        return err({
          type: 'process',
          code: 'review_no_response',
          message: 'Reviewable returned an empty response list',
        });
      }

      const response = pickPrimaryResponse(responses);

      switch (response.decision) {
        case 'approved':
          return ok(response.value);
        case 'rejected':
          return err({
            type: 'process',
            code: 'review_rejected',
            message: response.reason ?? 'Review rejected',
            reason: response.reason,
          });
        case 'retry':
          return err({
            type: 'transient',
            code: 'review_retry_requested',
            message: response.feedback ?? 'Reviewer requested retry',
          });
        case 'ignored':
          return err({
            type: 'process',
            code: 'review_ignored',
            message: response.reason ?? 'Review ignored',
            reason: response.reason,
          });
      }
    },
  };
}

function pickPrimaryResponse<I>(responses: ReadonlyArray<ReviewResponse<I>>): ReviewResponse<I> {
  for (const r of responses) {
    if (r.decision !== 'ignored') return r;
  }
  const last = responses.at(-1);
  if (last === undefined) {
    throw new Error('pickPrimaryResponse called with empty list');
  }
  return last;
}

import { describe, expect, it } from 'vitest';
import { createContext } from '../src/context.js';
import { review as reviewId } from '../src/ids.js';
import { err, ok } from '../src/result.js';
import type { Reviewable } from '../src/reviewable.js';
import { reviewableToProcess } from '../src/reviewable-to-process.js';

const baseConfig = {
  allowApprove: true,
  allowReject: true,
  allowEdit: true,
  allowRetry: true,
  allowIgnore: true,
};

const ctx = () => createContext({ pipelineId: 'pk_pipe_test' });

const reviewable = <I>(
  fn: Reviewable<I>['review'],
  describeFn?: Reviewable<I>['describe'],
): Reviewable<I> => ({
  id: reviewId(),
  config: baseConfig,
  describe: describeFn ?? ((input) => JSON.stringify(input)),
  review: fn,
});

describe('reviewableToProcess — decision mapping', () => {
  it('approved decision returns ok(value) preserving I shape', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () =>
        ok([{ decision: 'approved', value: 'kept', wasEdited: false }]),
      ),
    );
    const out = await r.run('original', ctx());
    expect(out.error).toBeNull();
    expect(out.data).toBe('kept');
  });

  it('approved with edit returns ok(edited value)', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () =>
        ok([{ decision: 'approved', value: 'edited', wasEdited: true }]),
      ),
    );
    const out = await r.run('original', ctx());
    expect(out.data).toBe('edited');
  });

  it('rejected decision returns process error code review_rejected', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () => ok([{ decision: 'rejected', reason: 'no thanks' }])),
    );
    const out = await r.run('x', ctx());
    expect(out.error?.type).toBe('process');
    expect(out.error?.code).toBe('review_rejected');
    expect(out.error?.message).toBe('no thanks');
  });

  it('rejected without reason uses default message', async () => {
    const r = reviewableToProcess(reviewable<string>(async () => ok([{ decision: 'rejected' }])));
    const out = await r.run('x', ctx());
    expect(out.error?.code).toBe('review_rejected');
    expect(out.error?.message).toBe('Review rejected');
  });

  it('retry decision returns transient error code review_retry_requested', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () => ok([{ decision: 'retry', feedback: 'try again' }])),
    );
    const out = await r.run('x', ctx());
    expect(out.error?.type).toBe('transient');
    expect(out.error?.code).toBe('review_retry_requested');
  });

  it('retry without feedback uses default message', async () => {
    const r = reviewableToProcess(reviewable<string>(async () => ok([{ decision: 'retry' }])));
    const out = await r.run('x', ctx());
    expect(out.error?.message).toBe('Reviewer requested retry');
  });

  it('sole-ignored decision returns process error code review_ignored', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () => ok([{ decision: 'ignored', reason: 'skip' }])),
    );
    const out = await r.run('x', ctx());
    expect(out.error?.type).toBe('process');
    expect(out.error?.code).toBe('review_ignored');
  });

  it('ignored without reason uses default message', async () => {
    const r = reviewableToProcess(reviewable<string>(async () => ok([{ decision: 'ignored' }])));
    const out = await r.run('x', ctx());
    expect(out.error?.message).toBe('Review ignored');
  });
});

describe('reviewableToProcess — list-of-responses handling', () => {
  it('picks the first non-ignored response when multiple are returned', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () =>
        ok([
          { decision: 'ignored', reason: 'first reviewer skipped' },
          { decision: 'approved', value: 'second-reviewer-said-yes', wasEdited: false },
        ]),
      ),
    );
    const out = await r.run('x', ctx());
    expect(out.data).toBe('second-reviewer-said-yes');
  });

  it('falls through to last response when all are ignored', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () =>
        ok([
          { decision: 'ignored', reason: 'one' },
          { decision: 'ignored', reason: 'two' },
        ]),
      ),
    );
    const out = await r.run('x', ctx());
    expect(out.error?.code).toBe('review_ignored');
    expect(out.error?.message).toBe('two');
  });

  it('empty response list returns review_no_response error', async () => {
    const r = reviewableToProcess(reviewable<string>(async () => ok([])));
    const out = await r.run('x', ctx());
    expect(out.error?.type).toBe('process');
    expect(out.error?.code).toBe('review_no_response');
  });
});

describe('reviewableToProcess — ReviewError propagation', () => {
  it('transport error propagates as process review_failed', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () =>
        err({ type: 'transport', code: 'http_500', message: 'gatewerk down' }),
      ),
    );
    const out = await r.run('x', ctx());
    expect(out.error?.type).toBe('process');
    expect(out.error?.code).toBe('review_failed');
    expect(out.error?.message).toBe('gatewerk down');
  });

  it('cancelled review error propagates as process review_failed', async () => {
    const r = reviewableToProcess(
      reviewable<string>(async () =>
        err({ type: 'cancelled', code: 'aborted', message: 'review cancelled' }),
      ),
    );
    const out = await r.run('x', ctx());
    expect(out.error?.code).toBe('review_failed');
  });
});

describe('reviewableToProcess — Process metadata', () => {
  it('returns Process<I,I> with a generated proc id', () => {
    const r = reviewableToProcess(reviewable<string>(async () => ok([])));
    expect(r.id).toMatch(/^pk_proc_/);
  });
});

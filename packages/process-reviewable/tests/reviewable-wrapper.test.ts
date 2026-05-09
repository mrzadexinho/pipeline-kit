import {
  err,
  ok,
  type PipelineContext,
  type Reviewable,
  reviewableToProcess,
} from '@idriszade/core';
import { describe, expect, it } from 'vitest';
import { reviewableWrapper } from '../src/reviewable-wrapper.js';

const fakeCtx = (): PipelineContext => ({
  runId: 'pk_run_x',
  pipelineId: 'pk_pipe_x',
  attempt: 1,
  metadata: {},
  signal: new AbortController().signal,
  trace: undefined as never,
  attachMetadata() {},
});

const baseConfig = {
  allowApprove: true,
  allowReject: true,
  allowEdit: true,
  allowRetry: true,
  allowIgnore: true,
};

const makeReviewable = <I>(fn: Reviewable<I>['review']): Reviewable<I> => ({
  id: 'pk_review_test',
  config: baseConfig,
  describe: (input) => JSON.stringify(input),
  review: fn,
});

describe('reviewableWrapper', () => {
  it('is the same function as core reviewableToProcess (sugar over primitive)', () => {
    expect(reviewableWrapper).toBe(reviewableToProcess);
  });
});

describe('reviewableWrapper — 5 decision types', () => {
  it('approved decision propagates value as Process success', async () => {
    const proc = reviewableWrapper(
      makeReviewable<string>(async (input) =>
        ok([{ decision: 'approved', value: input, wasEdited: false }]),
      ),
    );
    const r = await proc.run('hi', fakeCtx());
    expect(r.error).toBeNull();
    expect(r.data).toBe('hi');
  });

  it('rejected decision yields process error code review_rejected', async () => {
    const proc = reviewableWrapper(
      makeReviewable<string>(async () => ok([{ decision: 'rejected', reason: 'no' }])),
    );
    const r = await proc.run('hi', fakeCtx());
    expect(r.error?.type).toBe('process');
    expect(r.error?.code).toBe('review_rejected');
  });

  it('retry decision yields transient error code review_retry_requested', async () => {
    const proc = reviewableWrapper(
      makeReviewable<string>(async () => ok([{ decision: 'retry', feedback: 'try again' }])),
    );
    const r = await proc.run('hi', fakeCtx());
    expect(r.error?.type).toBe('transient');
    expect(r.error?.code).toBe('review_retry_requested');
  });

  it('ignored (sole) decision yields process error code review_ignored', async () => {
    const proc = reviewableWrapper(
      makeReviewable<string>(async () => ok([{ decision: 'ignored', reason: 'skip' }])),
    );
    const r = await proc.run('hi', fakeCtx());
    expect(r.error?.type).toBe('process');
    expect(r.error?.code).toBe('review_ignored');
  });

  it('ReviewError decision yields process error code review_failed', async () => {
    const proc = reviewableWrapper(
      makeReviewable<string>(async () =>
        err({ type: 'transport', code: 'http_503', message: 'gatewerk unavailable' }),
      ),
    );
    const r = await proc.run('hi', fakeCtx());
    expect(r.error?.type).toBe('process');
    expect(r.error?.code).toBe('review_failed');
  });
});

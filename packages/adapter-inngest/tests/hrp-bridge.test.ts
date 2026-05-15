import { NonRetriableError } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { createHrpCheckpoint } from '../src/hrp-bridge.js';
import type { HrpCheckpointOptions } from '../src/hrp-bridge.js';
import type { StepTools } from '../src/create-kit-function.js';

function makeStep(reviewEventResult: unknown | null): {
  step: StepTools;
  runMock: ReturnType<typeof vi.fn>;
  waitForEventMock: ReturnType<typeof vi.fn>;
} {
  const runMock = vi.fn(async (_id: string, fn: () => unknown) => fn());
  const waitForEventMock = vi.fn(async () => reviewEventResult);
  const sendEventMock = vi.fn(async () => undefined);

  const step: StepTools = {
    run: runMock as StepTools['run'],
    invoke: vi.fn(),
    waitForEvent: waitForEventMock as StepTools['waitForEvent'],
    sendEvent: sendEventMock,
  };

  return { step, runMock, waitForEventMock };
}

function approvedEvent(approved: boolean, reviewer?: string): unknown {
  return { data: { runId: 'pk_run_abc', approved, reviewer } };
}

const baseOpts: HrpCheckpointOptions = {
  runId: 'pk_run_abc',
  timeout: '1h',
};

describe('createHrpCheckpoint', () => {
  it('calls sendReviewRequest when provided', async () => {
    const { step } = makeStep(approvedEvent(true));
    const sendReviewRequest = vi.fn(async () => undefined);

    await createHrpCheckpoint(step, { ...baseOpts, sendReviewRequest });

    expect(sendReviewRequest).toHaveBeenCalledOnce();
    expect(sendReviewRequest).toHaveBeenCalledWith('pk_run_abc');
  });

  it('skips sendReviewRequest when not provided', async () => {
    const { step, runMock } = makeStep(approvedEvent(true));

    await createHrpCheckpoint(step, baseOpts);

    // step.run should not have been called since no sendReviewRequest
    expect(runMock).not.toHaveBeenCalled();
  });

  it('calls step.waitForEvent with correct event name and match', async () => {
    const { step, waitForEventMock } = makeStep(approvedEvent(true));

    await createHrpCheckpoint(step, { ...baseOpts, timeout: '30m' });

    expect(waitForEventMock).toHaveBeenCalledOnce();
    expect(waitForEventMock).toHaveBeenCalledWith('hrp-wait-review', {
      event: 'hrp/review.completed',
      timeout: '30m',
      match: 'data.runId',
    });
  });

  it('returns approved=true when review event has approved=true', async () => {
    const { step } = makeStep(approvedEvent(true));

    const result = await createHrpCheckpoint(step, baseOpts);

    expect(result.approved).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('returns approved=false when review event has approved=false', async () => {
    const { step } = makeStep(approvedEvent(false));

    const result = await createHrpCheckpoint(step, baseOpts);

    expect(result.approved).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it('returns reviewer name from event data', async () => {
    const { step } = makeStep(approvedEvent(true, 'alice@example.com'));

    const result = await createHrpCheckpoint(step, baseOpts);

    expect(result.reviewer).toBe('alice@example.com');
  });

  it("timeout with policy='continue' returns { approved: false, timedOut: true }", async () => {
    const { step } = makeStep(null);

    const result = await createHrpCheckpoint(step, {
      ...baseOpts,
      timeoutPolicy: 'continue',
    });

    expect(result.approved).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("timeout with policy='error' throws NonRetriableError", async () => {
    const { step } = makeStep(null);

    await expect(
      createHrpCheckpoint(step, { ...baseOpts, timeoutPolicy: 'error' }),
    ).rejects.toThrow(NonRetriableError);
  });

  it('default timeout policy is continue (returns timedOut=true, not throw)', async () => {
    const { step } = makeStep(null);

    // No timeoutPolicy specified — should NOT throw
    const result = await createHrpCheckpoint(step, baseOpts);

    expect(result.timedOut).toBe(true);
    expect(result.approved).toBe(false);
  });
});

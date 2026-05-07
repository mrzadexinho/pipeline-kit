import { createPipelineKit, ok, type Reviewable, runComposer } from '@pipeline-kit/core';
import { describe, expect, it } from 'vitest';

describe('Reviewable<I> interface conformance', () => {
  const triviallyApproving: Reviewable<string> = {
    id: 'pk_review_trivial',
    config: {
      allowApprove: true,
      allowReject: false,
      allowEdit: false,
      allowRetry: false,
      allowIgnore: false,
    },
    describe: (input) => `review ${input}`,
    async review(input, _ctx) {
      return ok([{ decision: 'approved', value: input, wasEdited: false, reviewer: 'auto' }]);
    },
  };

  it('a trivial in-memory Reviewable conforms to the interface contract', () => {
    expect(triviallyApproving.id).toBe('pk_review_trivial');
    expect(triviallyApproving.config.allowApprove).toBe(true);
    expect(typeof triviallyApproving.describe).toBe('function');
    expect(typeof triviallyApproving.review).toBe('function');
  });

  it('returns Result<ReviewResponse<I>[], ReviewError> shape with single-response list', async () => {
    const fakeCtx = {
      runId: 'pk_run_x',
      pipelineId: 'pk_pipe_x',
      attempt: 1,
      metadata: {},
      signal: new AbortController().signal,
      trace: undefined as never,
      attachMetadata() {},
    };
    const result = await triviallyApproving.review('hello', fakeCtx);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.decision).toBe('approved');
    if (result.data?.[0]?.decision === 'approved') {
      expect(result.data[0].value).toBe('hello');
      expect(result.data[0].wasEdited).toBe(false);
    }
  });

  it('integrates end-to-end via Composer when wrapped as a Process step', async () => {
    const r = await runComposer({
      pipelineId: 'pk_pipe_review_integration',
      steps: [
        {
          id: 'pk_proc_review',
          kind: 'review',
          async run(input, ctx) {
            const reviewResult = await triviallyApproving.review(input as string, ctx);
            if (reviewResult.error !== null) {
              return {
                data: null,
                error: { type: 'process', code: 'review_failed', message: 'failed' },
              };
            }
            const first = reviewResult.data[0];
            if (first === undefined || first.decision !== 'approved') {
              return {
                data: null,
                error: { type: 'process', code: 'no_approval', message: 'unexpected' },
              };
            }
            return ok(first.value);
          },
        },
      ],
      initialInput: 'world',
    });
    expect(r.error).toBeNull();
    expect(r.data?.output).toBe('world');
  });

  it('createPipelineKit + Reviewable interop is a smoke check', () => {
    const pk = createPipelineKit();
    expect(pk.webhooks).toBeDefined();
    expect(triviallyApproving.config.allowReject).toBe(false);
  });
});

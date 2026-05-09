import { ok, type PipelineContext } from '@idriszade/core';
import fc from 'fast-check';
import { describe, it } from 'vitest';
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

describe('Reviewable property — approved preserves I shape', () => {
  it('approved with wasEdited=false returns Object.is(input, value) for any input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), async (input) => {
        const proc = reviewableWrapper({
          id: 'pk_review_prop',
          config: {
            allowApprove: true,
            allowReject: true,
            allowEdit: false,
            allowRetry: false,
            allowIgnore: false,
          },
          describe: () => '',
          async review(i) {
            return ok([{ decision: 'approved', value: i, wasEdited: false }]);
          },
        });
        const result = await proc.run(input, fakeCtx());
        return result.error === null && Object.is(result.data, input);
      }),
      { numRuns: 30 },
    );
  });

  it('approved with edit returns the edited value (not the original input)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (original, edited) => {
        fc.pre(original !== edited);
        const proc = reviewableWrapper<string>({
          id: 'pk_review_edit',
          config: {
            allowApprove: true,
            allowReject: true,
            allowEdit: true,
            allowRetry: false,
            allowIgnore: false,
          },
          describe: () => '',
          async review(_input) {
            return ok([{ decision: 'approved', value: edited, wasEdited: true }]);
          },
        });
        const result = await proc.run(original, fakeCtx());
        return result.error === null && result.data === edited;
      }),
      { numRuns: 20 },
    );
  });

  it('typeof input === typeof value for primitives on approval', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.float()),
        async (input) => {
          const proc = reviewableWrapper({
            id: 'pk_review_typeof',
            config: {
              allowApprove: true,
              allowReject: true,
              allowEdit: false,
              allowRetry: false,
              allowIgnore: false,
            },
            describe: () => '',
            async review(i) {
              return ok([{ decision: 'approved', value: i, wasEdited: false }]);
            },
          });
          const result = await proc.run(input, fakeCtx());
          return result.error === null && typeof result.data === typeof input;
        },
      ),
      { numRuns: 30 },
    );
  });
});

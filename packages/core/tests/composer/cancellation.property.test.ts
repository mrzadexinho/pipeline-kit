import { type ComposerStep, ok, runComposer } from '@pipeline-kit/core';
import fc from 'fast-check';
import { describe, it } from 'vitest';

describe('Cancellation property — abort yields error.type === cancelled', () => {
  it('aborting at any stage index yields cancelled RunError without unhandled rejection', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 4 }),
        async (stageCount, abortAt) => {
          const ac = new AbortController();
          const cappedAbort = Math.min(abortAt, stageCount - 1);
          const steps: ComposerStep[] = Array.from({ length: stageCount }, (_, i) => ({
            id: `pk_proc_${i}`,
            kind: 'process',
            async run(input) {
              if (i === cappedAbort) ac.abort();
              return ok(input);
            },
          }));
          const r = await runComposer({
            pipelineId: 'pk_pipe_cancel_prop',
            steps,
            initialInput: 'in',
            signal: ac.signal,
          });
          return r.error?.type === 'cancelled';
        },
      ),
      { numRuns: 20 },
    );
  });

  it('pre-aborted signal always yields cancelled RunError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (stageCount) => {
        const ac = new AbortController();
        ac.abort();
        const steps: ComposerStep[] = Array.from({ length: stageCount }, (_, i) => ({
          id: `pk_proc_${i}`,
          kind: 'process',
          async run(input) {
            return ok(input);
          },
        }));
        const r = await runComposer({
          pipelineId: 'pk_pipe_pre_abort',
          steps,
          initialInput: 'in',
          signal: ac.signal,
        });
        return r.error?.type === 'cancelled';
      }),
      { numRuns: 10 },
    );
  });
});

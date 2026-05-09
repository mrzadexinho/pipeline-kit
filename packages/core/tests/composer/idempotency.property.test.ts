import { type ComposerStep, ok, runComposer } from '@idriszade/core';
import fc from 'fast-check';
import { describe, it } from 'vitest';

describe('Idempotency property — same key observed by all stages across runs', () => {
  it('explicit idempotencyKey propagates verbatim across N runs and S stages', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 30 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 5 }),
        async (keySuffix, runs, stageCount) => {
          const seen: string[] = [];
          const steps: ComposerStep[] = Array.from({ length: stageCount }, (_, i) => ({
            id: `pk_proc_${i}`,
            kind: 'process',
            async run(input, ctx) {
              seen.push(ctx.idempotencyKey ?? '<missing>');
              return ok(input);
            },
          }));

          const idempKey = `pk_evt_${keySuffix.replaceAll(',', '_')}`;
          for (let i = 0; i < runs; i++) {
            await runComposer({
              pipelineId: 'pk_pipe_idem',
              steps,
              initialInput: 'seed',
              idempotencyKey: idempKey,
            });
          }

          return seen.length === runs * stageCount && seen.every((k) => k === idempKey);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('auto-generated idempotency key is non-empty and unique across runs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (runs) => {
        const observed: string[] = [];
        const step: ComposerStep = {
          id: 'pk_proc_x',
          kind: 'process',
          async run(input, ctx) {
            observed.push(ctx.idempotencyKey ?? '');
            return ok(input);
          },
        };
        for (let i = 0; i < runs; i++) {
          await runComposer({
            pipelineId: 'pk_pipe_idem_auto',
            steps: [step],
            initialInput: 'seed',
          });
        }
        return new Set(observed).size === runs && observed.every((k) => k.startsWith('pk_evt_'));
      }),
      { numRuns: 10 },
    );
  });
});

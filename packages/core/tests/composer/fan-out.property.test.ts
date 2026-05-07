import fc from 'fast-check';
import { describe, it } from 'vitest';
import { type ComposerStep, runComposer } from '../../src/composer/composer.js';
import type { PipelineContext } from '../../src/context.js';
import { atom as atomId, proc as procId, serve as serveId, src as srcId } from '../../src/ids.js';
import { ok } from '../../src/result.js';
import type { Atom } from '../../src/stages/atom.js';
import type { Source, SourceQuery } from '../../src/stages/source.js';

function buildAtom<T>(data: T): Atom<T> {
  return {
    id: atomId(),
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: {},
    data,
  };
}

function makeIterSource(atoms: Atom<unknown>[]): Source<unknown> {
  return {
    id: srcId(),
    schema: { parse: (v: unknown) => v } as never,
    async *iter(_query: SourceQuery, _ctx: PipelineContext) {
      for (const a of atoms) {
        yield a;
      }
    },
    async fetch() {
      return ok(atoms);
    },
  };
}

describe('fan-out property — process invocation count equals emit count', () => {
  it('Process.run invocation count equals N for arbitrary N atoms (1..20)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (n) => {
        const atoms = Array.from({ length: n }, (_, i) => buildAtom(`item_${i}`));
        const source = makeIterSource(atoms);
        let invocationCount = 0;

        const step: ComposerStep = {
          id: procId(),
          kind: 'process',
          async run(input, _ctx) {
            invocationCount++;
            return ok(input);
          },
        };

        await runComposer({
          pipelineId: 'pk_pipe_prop_process',
          steps: [step],
          source: { adapter: source, query: undefined },
        });

        return invocationCount === n;
      }),
      { numRuns: 20 },
    );
  });
});

describe('fan-out property — serve idempotency key uniqueness', () => {
  it('all N Serve idempotency keys are pairwise distinct for arbitrary N atoms (1..20)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (n) => {
        const atoms = Array.from({ length: n }, (_, i) => buildAtom(`data_${i}`));
        const source = makeIterSource(atoms);
        const seenKeys: Set<string> = new Set();
        let callCount = 0;

        const step: ComposerStep = {
          id: serveId(),
          kind: 'serve',
          async run(input, ctx) {
            if (ctx.idempotencyKey !== undefined) seenKeys.add(ctx.idempotencyKey);
            callCount++;
            return ok(input);
          },
        };

        const r = await runComposer({
          pipelineId: 'pk_pipe_prop_serve',
          steps: [step],
          source: { adapter: source, query: undefined },
        });

        if (r.error !== null) return false;
        // All N Serve invocations must have distinct scoped idempotency keys
        return callCount === n && seenKeys.size === n;
      }),
      { numRuns: 20 },
    );
  });
});

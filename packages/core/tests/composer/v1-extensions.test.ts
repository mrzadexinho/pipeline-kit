import { describe, expect, it, vi } from 'vitest';
import { type ComposerStep, runComposer } from '../../src/composer/composer.js';
import type { PipelineContext } from '../../src/context.js';
import { createDisposableRegistry } from '../../src/disposable.js';
import { atom as atomId, proc as procId, src as srcId } from '../../src/ids.js';
import { ok } from '../../src/result.js';
import type { Atom } from '../../src/stages/atom.js';
import type { Source, SourceQuery } from '../../src/stages/source.js';

// --- helpers -----------------------------------------------------------

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

const successStep = (id: string, kind: ComposerStep['kind'], output: unknown): ComposerStep => ({
  id,
  kind,
  async run(_input, _ctx) {
    return ok(output);
  },
});

// A step that records usage after running, simulating an adapter that meters tokens
function usageRecordingStep(
  id: string,
  metric: string,
  delta: number,
  output: unknown,
): ComposerStep {
  return {
    id,
    kind: 'process',
    async run(_input, ctx) {
      ctx.usage.record(metric, delta);
      return ok(output);
    },
  };
}

// --- Budget tests -------------------------------------------------------

describe('Composer v1 — budget abort (sequential)', () => {
  it('returns runtime_budget_exceeded when usage meets limit', async () => {
    const step = usageRecordingStep(procId(), 'tokens', 100, 'out');
    const r = await runComposer({
      pipelineId: 'pk_pipe_budget_abort',
      steps: [step],
      initialInput: {},
      costBudget: [{ metric: 'tokens', limit: 100, action: 'abort' }],
    });

    expect(r.error).not.toBeNull();
    expect(r.error?.code).toBe('runtime_budget_exceeded');
    expect(r.error?.type).toBe('unknown');
    expect(r.error?.message).toMatch(/tokens/);
    expect(r.error?.message).toMatch(/100/);
  });

  it('does NOT abort when usage is below limit', async () => {
    const step = usageRecordingStep(procId(), 'tokens', 50, 'out');
    const r = await runComposer({
      pipelineId: 'pk_pipe_budget_ok',
      steps: [step],
      initialInput: {},
      costBudget: [{ metric: 'tokens', limit: 100, action: 'abort' }],
    });

    expect(r.error).toBeNull();
    expect(r.data?.output).toBe('out');
  });

  it('aborts after the exceeding step, not before', async () => {
    const order: string[] = [];
    const steps: ComposerStep[] = [
      {
        id: procId(),
        kind: 'process',
        async run(_input, ctx) {
          order.push('step1');
          ctx.usage.record('tokens', 60);
          return ok('s1');
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(_input, ctx) {
          order.push('step2');
          ctx.usage.record('tokens', 60); // total = 120 >= 100
          return ok('s2');
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(_input, _ctx) {
          order.push('step3'); // should NOT run
          return ok('s3');
        },
      },
    ];

    const r = await runComposer({
      pipelineId: 'pk_pipe_budget_mid',
      steps,
      initialInput: {},
      costBudget: [{ metric: 'tokens', limit: 100, action: 'abort' }],
    });

    expect(r.error?.code).toBe('runtime_budget_exceeded');
    expect(order).toEqual(['step1', 'step2']);
  });
});

describe('Composer v1 — budget warn (sequential)', () => {
  it('logs a console.warn and continues when action is warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const step = usageRecordingStep(procId(), 'tokens', 200, 'done');

    const r = await runComposer({
      pipelineId: 'pk_pipe_budget_warn',
      steps: [step],
      initialInput: {},
      costBudget: [{ metric: 'tokens', limit: 100, action: 'warn' }],
    });

    expect(r.error).toBeNull();
    expect(r.data?.output).toBe('done');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/tokens/);
    warnSpy.mockRestore();
  });
});

describe('Composer v1 — budget review stub (sequential)', () => {
  it('is a no-op in M1; pipeline completes normally', async () => {
    const step = usageRecordingStep(procId(), 'tokens', 200, 'done');

    const r = await runComposer({
      pipelineId: 'pk_pipe_budget_review',
      steps: [step],
      initialInput: {},
      costBudget: [{ metric: 'tokens', limit: 100, action: 'review' }],
    });

    expect(r.error).toBeNull();
    expect(r.data?.output).toBe('done');
  });
});

describe('Composer v1 — budget in fan-out', () => {
  it('abort budget triggered per atom step in fan-out', async () => {
    const atoms = [buildAtom('a1'), buildAtom('a2'), buildAtom('a3')];
    const source = makeIterSource(atoms);

    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, ctx) {
        ctx.usage.record('calls', 1); // cumulative across atoms
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_budget_abort',
      steps: [step],
      source: { adapter: source, query: undefined },
      costBudget: [{ metric: 'calls', limit: 2, action: 'abort' }],
    });

    // After atom 2, calls = 2 >= 2, so abort
    expect(r.error?.code).toBe('runtime_budget_exceeded');
  });
});

// --- Disposal tests -----------------------------------------------------

describe('Composer v1 — disposal on success (sequential)', () => {
  it('calls disposeAll after a successful pipeline run', async () => {
    const registry = createDisposableRegistry();
    const disposed: string[] = [];
    registry.register('res-a', async () => {
      disposed.push('res-a');
    });

    const step = successStep(procId(), 'process', 'out');
    const r = await runComposer({
      pipelineId: 'pk_pipe_disposal_ok',
      steps: [step],
      initialInput: {},
      registry,
    });

    expect(r.error).toBeNull();
    expect(disposed).toEqual(['res-a']);
  });
});

describe('Composer v1 — disposal on stage error (sequential)', () => {
  it('calls disposeAll even when a stage returns an error', async () => {
    const registry = createDisposableRegistry();
    const disposed: string[] = [];
    registry.register('res-b', async () => {
      disposed.push('res-b');
    });

    const failStep: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(_input, _ctx) {
        return {
          data: null,
          error: { type: 'permanent', code: 'fail', message: 'boom' },
        };
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_disposal_err',
      steps: [failStep],
      initialInput: {},
      registry,
    });

    expect(r.error).not.toBeNull();
    expect(disposed).toEqual(['res-b']);
  });
});

describe('Composer v1 — disposal on cancellation (sequential)', () => {
  it('calls disposeAll when pipeline is cancelled mid-run', async () => {
    const ac = new AbortController();
    const registry = createDisposableRegistry();
    const disposed: string[] = [];
    registry.register('res-c', async () => {
      disposed.push('res-c');
    });

    const steps: ComposerStep[] = [
      {
        id: procId(),
        kind: 'process',
        async run(_input, _ctx) {
          ac.abort();
          return ok('aborted-after-this');
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(_input, _ctx) {
          return ok('never-reached');
        },
      },
    ];

    const r = await runComposer({
      pipelineId: 'pk_pipe_disposal_cancel',
      steps,
      initialInput: {},
      signal: ac.signal,
      registry,
    });

    expect(r.error?.type).toBe('cancelled');
    expect(disposed).toEqual(['res-c']);
  });
});

describe('Composer v1 — disposal in fan-out', () => {
  it('disposeAll called after successful fan-out run', async () => {
    const registry = createDisposableRegistry();
    const disposed: string[] = [];
    registry.register('fan-res', async () => {
      disposed.push('fan-res');
    });

    const atoms = [buildAtom('x1'), buildAtom('x2')];
    const source = makeIterSource(atoms);
    const step = successStep(procId(), 'process', 'ok');

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_disposal_ok',
      steps: [step],
      source: { adapter: source, query: undefined },
      registry,
    });

    expect(r.error).toBeNull();
    expect(disposed).toEqual(['fan-res']);
  });

  it('disposeAll called after fan-out stage error', async () => {
    const registry = createDisposableRegistry();
    const disposed: string[] = [];
    registry.register('fan-res-err', async () => {
      disposed.push('fan-res-err');
    });

    const atoms = [buildAtom('x1')];
    const source = makeIterSource(atoms);
    const failStep: ComposerStep = {
      id: procId(),
      kind: 'process',
      retryPolicy: { maxAttempts: 1 },
      async run(_input, _ctx) {
        return {
          data: null,
          error: { type: 'permanent', code: 'fail', message: 'boom' },
        };
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_disposal_err',
      steps: [failStep],
      source: { adapter: source, query: undefined },
      registry,
    });

    expect(r.error).not.toBeNull();
    expect(disposed).toEqual(['fan-res-err']);
  });
});

// --- Buffer 'all' tests ------------------------------------------------

describe('Composer v1 — buffer all', () => {
  it('collects all atom data into an array before passing to steps', async () => {
    const atoms = [buildAtom(1), buildAtom(2), buildAtom(3)];
    const source = makeIterSource(atoms);
    let stepInput: unknown;

    const collectStep: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        stepInput = input;
        return ok('collected');
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_buffer_all',
      steps: [collectStep],
      source: { adapter: source, query: undefined },
      buffer: { window: { type: 'all' } },
    });

    expect(r.error).toBeNull();
    expect(stepInput).toEqual([1, 2, 3]);
    expect(r.data?.atomCount).toBe(3);
  });

  it('chains steps after buffer collect; each step receives output of previous', async () => {
    const atoms = [buildAtom('a'), buildAtom('b')];
    const source = makeIterSource(atoms);

    const steps: ComposerStep[] = [
      {
        id: procId(),
        kind: 'process',
        async run(input, _ctx) {
          return ok((input as string[]).join(','));
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(input, _ctx) {
          return ok(`processed:${String(input)}`);
        },
      },
    ];

    const r = await runComposer({
      pipelineId: 'pk_pipe_buffer_all_chain',
      steps,
      source: { adapter: source, query: undefined },
      buffer: { window: { type: 'all' } },
    });

    expect(r.error).toBeNull();
    expect(r.data?.output).toBe('processed:a,b');
  });

  it('buffer all + disposal: disposeAll called after successful buffer run', async () => {
    const registry = createDisposableRegistry();
    const disposed: string[] = [];
    registry.register('buf-res', async () => {
      disposed.push('buf-res');
    });

    const atoms = [buildAtom(10), buildAtom(20)];
    const source = makeIterSource(atoms);
    const step = successStep(procId(), 'process', 'ok');

    const r = await runComposer({
      pipelineId: 'pk_pipe_buffer_all_disposal',
      steps: [step],
      source: { adapter: source, query: undefined },
      buffer: { window: { type: 'all' } },
      registry,
    });

    expect(r.error).toBeNull();
    expect(disposed).toEqual(['buf-res']);
  });

  it('buffer all + budget abort: exceeding budget in steps returns error', async () => {
    const atoms = [buildAtom('x1'), buildAtom('x2')];
    const source = makeIterSource(atoms);

    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(_input, ctx) {
        ctx.usage.record('tokens', 200);
        return ok('out');
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_buffer_all_budget',
      steps: [step],
      source: { adapter: source, query: undefined },
      buffer: { window: { type: 'all' } },
      costBudget: [{ metric: 'tokens', limit: 100, action: 'abort' }],
    });

    expect(r.error?.code).toBe('runtime_budget_exceeded');
  });
});

describe('Composer v1 — buffer count/time deferred', () => {
  it('throws a clear error for buffer window type count', async () => {
    const source = makeIterSource([buildAtom('x')]);
    const step = successStep(procId(), 'process', 'ok');

    await expect(
      runComposer({
        pipelineId: 'pk_pipe_buffer_count',
        steps: [step],
        source: { adapter: source, query: undefined },
        buffer: { window: { type: 'count', n: 5 } },
      }),
    ).rejects.toThrow(/count.*deferred.*M2/i);
  });

  it('throws a clear error for buffer window type time', async () => {
    const source = makeIterSource([buildAtom('x')]);
    const step = successStep(procId(), 'process', 'ok');

    await expect(
      runComposer({
        pipelineId: 'pk_pipe_buffer_time',
        steps: [step],
        source: { adapter: source, query: undefined },
        buffer: { window: { type: 'time' } },
      }),
    ).rejects.toThrow(/time.*deferred.*M2/i);
  });
});

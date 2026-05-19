import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  atom,
  proc as procId,
  review as reviewId,
  run,
  serve as serveId,
  src as srcId,
} from '../src/ids.js';
import { Pipeline } from '../src/pipeline.js';
import { err, ok } from '../src/result.js';
import type { Reviewable } from '../src/reviewable.js';
import type { Atom } from '../src/stages/atom.js';
import type { Process } from '../src/stages/process.js';
import type { Serve } from '../src/stages/serve.js';
import type { Source } from '../src/stages/source.js';

const stringSchema = z.string();
const numberSchema = z.number();

const buildAtom = (data: string): Atom<string> => ({
  id: atom(),
  object: 'atom',
  created_at: new Date().toISOString(),
  metadata: {},
  data,
  run_id: run(),
});

const stringSource: Source<string> = {
  id: srcId(),
  schema: stringSchema,
  async *iter(_query, _ctx) {
    yield buildAtom('hello');
  },
  async fetch() {
    return ok([buildAtom('hello')]);
  },
};

const upperProcess: Process<string, string> = {
  id: procId(),
  inputSchema: stringSchema,
  outputSchema: stringSchema,
  async run(input) {
    return ok(input.toUpperCase());
  },
};

const lengthProcess: Process<string, number> = {
  id: procId(),
  inputSchema: stringSchema,
  outputSchema: numberSchema,
  async run(input) {
    return ok(input.length);
  },
};

const recordingServe = (recorded: string[]): Serve<string> => ({
  id: serveId(),
  schema: stringSchema,
  idempotencySupport: 'optional',
  async emit(input) {
    recorded.push(input);
    return ok({
      id: 'emit_test',
      emitted_at: new Date().toISOString(),
      metadata: {},
    });
  },
});

const approvingReviewable: Reviewable<string> = {
  id: reviewId(),
  config: {
    allowApprove: true,
    allowReject: true,
    allowEdit: true,
    allowRetry: true,
    allowIgnore: true,
  },
  describe(input) {
    return `review ${input}`;
  },
  async review(input) {
    return ok([{ decision: 'approved', value: input, wasEdited: false, reviewer: 'test' }]);
  },
};

const editingReviewable: Reviewable<string> = {
  ...approvingReviewable,
  async review(_input) {
    return ok([{ decision: 'approved', value: 'edited!', wasEdited: true, reviewer: 'test' }]);
  },
};

const rejectingReviewable: Reviewable<string> = {
  ...approvingReviewable,
  async review() {
    return ok([{ decision: 'rejected', reason: 'not approved', reviewer: 'test' }]);
  },
};

describe('Pipeline factory', () => {
  it('Pipeline.from(source) builds a SourcePipeline with one source step', () => {
    const p = Pipeline.from(stringSource);
    const def = p.describe();
    expect(def.steps.length).toBe(1);
    expect(def.steps[0]?.kind).toBe('source');
    expect(def.pipelineId).toMatch(/^pk_pipe_/);
  });

  it('chained .through().to() preserves step order and assigns serve as terminal', () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource).through(upperProcess).to(recordingServe(recorded));
    const def = terminal.describe();
    expect(def.steps.map((s) => s.kind)).toEqual(['source', 'process', 'serve']);
  });

  it('.review(rev) inserts a process step (sugar over reviewableToProcess)', () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource)
      .review(approvingReviewable)
      .to(recordingServe(recorded));
    const kinds = terminal.describe().steps.map((s) => s.kind);
    expect(kinds).toEqual(['source', 'process', 'serve']);
  });
});

describe('Pipeline.run() — Loop α validation', () => {
  it('runs source → process → serve end-to-end and emits to Serve', async () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource).through(upperProcess).to(recordingServe(recorded));

    const r = await terminal.run();
    expect(r.error).toBeNull();
    expect(recorded).toEqual(['HELLO']);
    expect(r.data?.runId).toMatch(/^pk_run_/);
    expect(r.data?.atomCount).toBeGreaterThan(0);
  });

  it('runs source → review (approving) → serve and preserves data', async () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource)
      .review(approvingReviewable)
      .to(recordingServe(recorded));

    const r = await terminal.run();
    expect(r.error).toBeNull();
    expect(recorded).toEqual(['hello']);
  });

  it('runs source → review (editing) → serve and emits the edited value', async () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource)
      .review(editingReviewable)
      .to(recordingServe(recorded));

    const r = await terminal.run();
    expect(r.error).toBeNull();
    expect(recorded).toEqual(['edited!']);
  });

  it('rejected review surfaces as RunError of type process_failed (non-retryable)', async () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource)
      .review(rejectingReviewable)
      .to(recordingServe(recorded));

    const r = await terminal.run();
    expect(r.error?.type).toBe('process_failed');
    expect(recorded).toEqual([]);
  });

  it('source error surfaces as RunError of type source_failed', async () => {
    const failingSource: Source<string> = {
      ...stringSource,
      async *iter() {
        yield* ((): never => {
          throw { type: 'auth', code: 'no_token', message: 'denied' };
        })();
      },
      async fetch() {
        return err({ type: 'auth', code: 'no_token', message: 'denied' });
      },
    };
    const recorded: string[] = [];
    const terminal = Pipeline.from(failingSource)
      .through(upperProcess)
      .to(recordingServe(recorded));

    const r = await terminal.run();
    expect(r.error?.type).toBe('source_failed');
  });

  it('chains process steps with input → output type narrowing through pipeline', async () => {
    const recorded: number[] = [];
    const numberServe: Serve<number> = {
      id: serveId(),
      schema: numberSchema,
      idempotencySupport: 'optional',
      async emit(input) {
        recorded.push(input);
        return ok({ id: 'e', emitted_at: '2026-01-01', metadata: {} });
      },
    };
    const terminal = Pipeline.from(stringSource).through(lengthProcess).to(numberServe);

    const r = await terminal.run();
    expect(r.error).toBeNull();
    expect(recorded).toEqual([5]);
  });

  it('passes RunOptions metadata + idempotencyKey to the run', async () => {
    const recorded: string[] = [];
    const terminal = Pipeline.from(stringSource).through(upperProcess).to(recordingServe(recorded));

    const r = await terminal.run(undefined, {
      metadata: { traceId: 'abc' },
      idempotencyKey: 'pk_evt_user',
    });
    expect(r.error).toBeNull();
    expect(r.data?.metadata.traceId).toBe('abc');
  });

  it('respects pre-aborted AbortSignal returning cancelled RunError', async () => {
    const recorded: string[] = [];
    const ac = new AbortController();
    ac.abort();
    const terminal = Pipeline.from(stringSource).through(upperProcess).to(recordingServe(recorded));

    const r = await terminal.run(undefined, { signal: ac.signal });
    expect(r.error?.type).toBe('cancelled');
    expect(recorded).toEqual([]);
  });

  it('source emitting no atoms surfaces source_failed with source_no_atoms', async () => {
    const emptySource: Source<string> = {
      ...stringSource,
      async *iter() {},
      async fetch() {
        return ok([]);
      },
    };
    const recorded: string[] = [];
    const terminal = Pipeline.from(emptySource).through(upperProcess).to(recordingServe(recorded));

    const r = await terminal.run();
    expect(r.error?.type).toBe('source_failed');
    expect(r.error?.code).toBe('source_no_atoms');
  });
});

describe('Pipeline.run() — costBudget enforcement (A4 + A5)', () => {
  it('returns runtime_budget_exceeded with usage metadata when budget is exceeded', async () => {
    const tokenSource: Source<string> = {
      id: srcId(),
      schema: stringSchema,
      async *iter(_query, _ctx) {
        yield { id: 'pk_atom_test', object: 'atom' as const, created_at: new Date().toISOString(), metadata: {}, data: 'hello', run_id: 'pk_run_test' };
      },
      async fetch() {
        return ok([{ id: 'pk_atom_test', object: 'atom' as const, created_at: new Date().toISOString(), metadata: {}, data: 'hello', run_id: 'pk_run_test' }]);
      },
    };

    const heavyProcess: Process<string, string> = {
      id: procId(),
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      async run(input, ctx) {
        ctx.usage.record('gen_ai.usage.input_tokens', 600);
        return ok(input.toUpperCase());
      },
    };

    const recorded: string[] = [];
    const terminal = Pipeline.from(tokenSource)
      .through(heavyProcess)
      .to(recordingServe(recorded));

    const r = await terminal.run(undefined, {
      costBudget: [{ metric: 'gen_ai.usage.input_tokens', limit: 500, action: 'abort' }],
    });

    expect(r.error).not.toBeNull();
    expect(r.error?.code).toBe('runtime_budget_exceeded');
    expect(r.error?.metadata?.['usage']).toBeDefined();
    const usageSnapshot = r.error?.metadata?.['usage'] as Record<string, number>;
    expect(usageSnapshot['gen_ai.usage.input_tokens']).toBe(600);
  });
});

describe('Pipeline.describe()', () => {
  it('returns the same definition structure for SourcePipeline and TerminalPipeline', () => {
    const recorded: string[] = [];
    const sourceP = Pipeline.from(stringSource).through(upperProcess);
    const terminal = sourceP.to(recordingServe(recorded));

    const sourceDef = sourceP.describe();
    const terminalDef = terminal.describe();
    expect(terminalDef.pipelineId).toBe(sourceDef.pipelineId);
    expect(terminalDef.steps.length).toBe(sourceDef.steps.length + 1);
  });
});

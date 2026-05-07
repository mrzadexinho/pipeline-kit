import { describe, expect, it } from 'vitest';
import { type ComposerStep, runComposer } from '../../src/composer/composer.js';
import { proc as procId } from '../../src/ids.js';
import { err, ok } from '../../src/result.js';

const successStep = (id: string, kind: ComposerStep['kind'], output: unknown): ComposerStep => ({
  id,
  kind,
  async run(_input, _ctx) {
    return ok(output);
  },
});

const failingStep = (id: string, kind: ComposerStep['kind'], errType: string): ComposerStep => ({
  id,
  kind,
  async run(_input, _ctx) {
    return err({ type: errType, code: 'stage_failed', message: 'stage error' });
  },
});

describe('runComposer — lifecycle', () => {
  it('runs a single-stage pipeline and returns ComposerResult', async () => {
    const step = successStep(procId(), 'process', { id: 1 });
    const r = await runComposer({
      pipelineId: 'pk_pipe_lifecycle',
      steps: [step],
      initialInput: { query: 'q' },
    });
    expect(r.error).toBeNull();
    expect(r.data?.output).toEqual({ id: 1 });
    expect(r.data?.atomCount).toBe(1);
    expect(r.data?.duration).toBeGreaterThanOrEqual(0);
    expect(r.data?.runId).toMatch(/^pk_run_/);
  });

  it('chains steps so each input is the previous output', async () => {
    const steps: ComposerStep[] = [
      {
        id: procId(),
        kind: 'process',
        async run(input, _ctx) {
          return ok(`stage1:${String(input)}`);
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(input, _ctx) {
          return ok(`stage2:${String(input)}`);
        },
      },
    ];
    const r = await runComposer({
      pipelineId: 'pk_pipe_chain',
      steps,
      initialInput: 'seed',
    });
    expect(r.data?.output).toBe('stage2:stage1:seed');
    expect(r.data?.atomCount).toBe(2);
  });

  it('exposes the constructed PipelineContext on success', async () => {
    const step = successStep(procId(), 'process', 'out');
    const r = await runComposer({
      pipelineId: 'pk_pipe_ctx',
      steps: [step],
      metadata: { source: 'test' },
    });
    expect(r.data?.ctx.pipelineId).toBe('pk_pipe_ctx');
    expect(r.data?.ctx.idempotencyKey).toMatch(/^pk_evt_/);
  });
});

describe('runComposer — error wrapping', () => {
  it('wraps non-retryable Process error into RunError with cause', async () => {
    const step = failingStep(procId(), 'process', 'permanent');
    const r = await runComposer({
      pipelineId: 'pk_pipe_err',
      steps: [step],
    });
    expect(r.error).not.toBeNull();
    expect(r.error?.type).toBe('process_failed');
    if (r.error?.type === 'process_failed') {
      expect(r.error.cause.type).toBe('permanent');
    }
  });

  it('wraps Source error into source_failed', async () => {
    const step = failingStep('pk_src_x', 'source', 'auth');
    const r = await runComposer({
      pipelineId: 'pk_pipe_src_err',
      steps: [step],
    });
    expect(r.error?.type).toBe('source_failed');
  });

  it('wraps Serve error into serve_failed', async () => {
    const step = failingStep('pk_serve_x', 'serve', 'idempotency_conflict');
    const r = await runComposer({
      pipelineId: 'pk_pipe_serve_err',
      steps: [step],
    });
    expect(r.error?.type).toBe('serve_failed');
  });
});

describe('runComposer — idempotency propagation', () => {
  it('auto-generates idempotency key when not provided', async () => {
    const step = successStep(procId(), 'process', 'x');
    const r = await runComposer({ pipelineId: 'pk_pipe_idem', steps: [step] });
    expect(r.data?.ctx.idempotencyKey).toMatch(/^pk_evt_/);
  });

  it('honors explicit idempotency key', async () => {
    const step = successStep(procId(), 'process', 'x');
    const r = await runComposer({
      pipelineId: 'pk_pipe_idem_explicit',
      steps: [step],
      idempotencyKey: 'pk_evt_user_supplied',
    });
    expect(r.data?.ctx.idempotencyKey).toBe('pk_evt_user_supplied');
  });

  it('all stages observe the same idempotency key in ctx', async () => {
    const seen: string[] = [];
    const stages: ComposerStep[] = [
      {
        id: procId(),
        kind: 'process',
        async run(_input, ctx) {
          seen.push(ctx.idempotencyKey ?? 'missing');
          return ok(1);
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(_input, ctx) {
          seen.push(ctx.idempotencyKey ?? 'missing');
          return ok(2);
        },
      },
    ];
    const r = await runComposer({
      pipelineId: 'pk_pipe_idem_propagate',
      steps: stages,
      idempotencyKey: 'pk_evt_shared',
    });
    expect(r.error).toBeNull();
    expect(seen).toEqual(['pk_evt_shared', 'pk_evt_shared']);
  });
});

describe('runComposer — cancellation', () => {
  it('returns cancelled RunError when signal is pre-aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const step = successStep(procId(), 'process', 'x');
    const r = await runComposer({
      pipelineId: 'pk_pipe_cancelled',
      steps: [step],
      signal: ac.signal,
    });
    expect(r.error?.type).toBe('cancelled');
  });

  it('aborts mid-pipeline between stages', async () => {
    const ac = new AbortController();
    let stage1Ran = false;
    const steps: ComposerStep[] = [
      {
        id: procId(),
        kind: 'process',
        async run(_input, _ctx) {
          stage1Ran = true;
          ac.abort();
          return ok('done');
        },
      },
      {
        id: procId(),
        kind: 'process',
        async run(_input, _ctx) {
          return ok('never');
        },
      },
    ];
    const r = await runComposer({
      pipelineId: 'pk_pipe_mid_cancel',
      steps,
      signal: ac.signal,
    });
    expect(stage1Ran).toBe(true);
    expect(r.error?.type).toBe('cancelled');
  });
});

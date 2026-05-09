import type { PipelineContext, Process } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import { ROOT_CONTEXT } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { createRouteProcess } from '../src/index.js';

function makeProcess(result: 'ok' | 'err', value: string): Process<unknown, string> {
  return {
    id: `pk_proc_${value}`,
    run: async (_input, _ctx) =>
      result === 'ok'
        ? ok(value)
        : err({
            type: 'permanent',
            code: 'branch_err',
            message: value,
          }),
  };
}

function makeCtx(): PipelineContext {
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: {},
    signal: new AbortController().signal,
    trace: ROOT_CONTEXT,
    attachMetadata() {},
  };
}

describe('route process', () => {
  it('branches to correct route when predicate returns matching branch name', async () => {
    const router = createRouteProcess({
      predicate: async () => 'fast',
      branches: {
        fast: makeProcess('ok', 'fast_result'),
        slow: makeProcess('ok', 'slow_result'),
      },
    });

    const result = await router.run({}, makeCtx());
    expect(result.data).toBe('fast_result');
    expect(result.error).toBeNull();
  });

  it('routes to default branch when predicate returns unknown branch name', async () => {
    const router = createRouteProcess({
      predicate: async () => 'unknown',
      branches: {
        fast: makeProcess('ok', 'fast_result'),
        fallback: makeProcess('ok', 'fallback_result'),
      },
      defaultBranch: 'fallback',
    });

    const result = await router.run({}, makeCtx());
    expect(result.data).toBe('fallback_result');
    expect(result.error).toBeNull();
  });

  it('returns error when no branch found and no default branch', async () => {
    const router = createRouteProcess({
      predicate: async () => 'missing',
      branches: {
        fast: makeProcess('ok', 'fast_result'),
      },
    });

    const result = await router.run({}, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('route_no_branch');
    expect(result.error?.type).toBe('permanent');
  });

  it('returns error when predicate throws', async () => {
    const router = createRouteProcess({
      predicate: async () => {
        throw new Error('bad input');
      },
      branches: {
        fast: makeProcess('ok', 'fast_result'),
      },
    });

    const result = await router.run({}, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('predicate_error');
    expect(result.error?.type).toBe('permanent');
    expect(result.error?.message).toBe('bad input');
  });
});

import { ROOT_CONTEXT } from '@opentelemetry/api';
import type { PipelineContext, Process } from '@idriszade/core';
import { ok } from '@idriszade/core';
import { describe, expect, it } from 'vitest';
import { createRouteProcess } from '../src/index.js';

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

describe('composition', () => {
  it('branches can themselves be Process composites', async () => {
    const innerProcess: Process<string, string> = {
      id: 'pk_proc_inner',
      run: async (input) => ok(`inner_${input}`),
    };

    const innerRouter = createRouteProcess({
      predicate: async () => 'process',
      branches: { process: innerProcess },
    });

    const outerRouter = createRouteProcess({
      predicate: async () => 'inner',
      branches: { inner: innerRouter },
    });

    const result = await outerRouter.run('hello', makeCtx());
    expect(result.data).toBe('inner_hello');
    expect(result.error).toBeNull();
  });
});

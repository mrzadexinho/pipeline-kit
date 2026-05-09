import { ROOT_CONTEXT } from '@opentelemetry/api';
import type { PipelineContext } from '@idriszade/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExtractProcess } from '../src/extract-process.js';

// Simulate openai SDK not being installed by making callOpenAI throw a module-not-found error
vi.mock('../src/providers/openai.js', () => ({
  callOpenAI: () => {
    const e = new Error('Cannot find module: openai');
    throw e;
  },
}));

const fakeCtx = (): PipelineContext => ({
  runId: 'pk_run_test',
  pipelineId: 'pk_pipe_test',
  attempt: 1,
  metadata: {},
  signal: new AbortController().signal,
  trace: ROOT_CONTEXT,
  attachMetadata() {},
});

const AnySchema = z.object({ value: z.string() });

describe('process-extract / provider-not-installed', () => {
  it('returns provider_not_installed when SDK import fails', async () => {
    const process = createExtractProcess({
      provider: 'openai',
      model: 'gpt-4o',
      prompt: 'Extract value',
      outputSchema: AnySchema,
      apiKey: 'sk-test',
    });

    const result = await process.run('test input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('provider_not_installed');
    expect(result.error?.type).toBe('permanent');
  });
});

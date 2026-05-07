import { ROOT_CONTEXT } from '@opentelemetry/api';
import type { PipelineContext } from '@pipeline-kit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExtractProcess } from '../src/extract-process.js';

const mockGenerateContent = vi.fn();

vi.mock('@google/generative-ai', () => {
  function GoogleGenerativeAI(_apiKey: string) {
    return {
      getGenerativeModel: (_opts: unknown) => ({
        generateContent: mockGenerateContent,
      }),
    };
  }
  return { GoogleGenerativeAI };
});

const fakeCtx = (): PipelineContext => ({
  runId: 'pk_run_test',
  pipelineId: 'pk_pipe_test',
  attempt: 1,
  metadata: {},
  signal: new AbortController().signal,
  trace: ROOT_CONTEXT,
  attachMetadata() {},
});

const TagsSchema = z.object({
  tags: z.array(z.string()),
  primary: z.string(),
});

function makeGeminiResponse(obj: unknown): unknown {
  return {
    response: {
      text: () => JSON.stringify(obj),
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
      candidates: [{ finishReason: 'STOP' }],
    },
  };
}

describe('process-extract / gemini', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('success', async () => {
    mockGenerateContent.mockResolvedValueOnce(
      makeGeminiResponse({ tags: ['typescript', 'ai'], primary: 'typescript' }),
    );

    const process = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags from text',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
    });

    const result = await process.run('TypeScript AI library', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ tags: ['typescript', 'ai'], primary: 'typescript' });
  });

  it('rate limit (quota exceeded)', async () => {
    const quotaError = Object.assign(new Error('Quota exceeded: 429 rate limit'), { status: 429 });
    mockGenerateContent.mockRejectedValueOnce(quotaError);

    const process = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
    });

    const result = await process.run('input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('rate_limited');
    expect(result.error?.type).toBe('transient');
  });

  it('schema retry succeeds on second pass', async () => {
    // First returns invalid schema (missing primary field)
    mockGenerateContent.mockResolvedValueOnce(makeGeminiResponse({ tags: ['node'] }));
    // Second returns valid
    mockGenerateContent.mockResolvedValueOnce(
      makeGeminiResponse({ tags: ['node'], primary: 'node' }),
    );

    const process = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
      maxRetriesOnSchemaFailure: 2,
    });

    const result = await process.run('Node.js library', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.primary).toBe('node');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});

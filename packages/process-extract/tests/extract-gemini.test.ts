import type { PipelineContext } from '@idriszade/core';
import { ROOT_CONTEXT } from '@opentelemetry/api';
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

  it('auth failure (401) maps to auth_failed', async () => {
    const authError = Object.assign(new Error('API key invalid'), { status: 401 });
    mockGenerateContent.mockRejectedValueOnce(authError);

    const process = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'bad-key',
    });

    const result = await process.run('input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('auth_failed');
    expect(result.error?.type).toBe('permanent');
  });

  it('missing apiKey throws auth_failed via provider guard', async () => {
    // Gemini provider throws status:401 if apiKey is undefined; ensure no env leak
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevGoogle = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    try {
      const proc = createExtractProcess({
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        prompt: 'Extract tags',
        outputSchema: TagsSchema,
        // intentionally no apiKey
      });

      const result = await proc.run('input', fakeCtx());
      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('auth_failed');
      expect(result.error?.type).toBe('permanent');
    } finally {
      if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
      if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
    }
  });

  it('schema retry exhausted', async () => {
    // All responses missing required 'primary' — schema fails every attempt
    mockGenerateContent.mockResolvedValue(makeGeminiResponse({ tags: ['ts'] }));

    const proc = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
      maxRetriesOnSchemaFailure: 1,
    });

    const result = await proc.run('input', fakeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('schema_parse_exhausted');
    expect(result.error?.type).toBe('validation');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('missing usageMetadata and candidates fall back to defaults', async () => {
    // Response without usageMetadata or candidates exercises the ?? 0 / ?? ['unknown'] branches
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({ tags: ['x'], primary: 'x' }),
        // no usageMetadata, no candidates
      },
    });

    const proc = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
    });

    const result = await proc.run('input', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.primary).toBe('x');
  });

  it('candidate with missing finishReason falls back to "unknown"', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({ tags: ['y'], primary: 'y' }),
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        candidates: [{}], // no finishReason
      },
    });

    const proc = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
    });

    const result = await proc.run('input', fakeCtx());
    expect(result.error).toBeNull();
    expect(result.data?.primary).toBe('y');
  });

  it('safety-block error from text() falls back to provider_unknown', async () => {
    // Simulate Gemini SDK throwing when accessing text() because the response was blocked
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => {
          throw new Error('Response was blocked due to SAFETY');
        },
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 0 },
        candidates: [{ finishReason: 'SAFETY' }],
      },
    });

    const proc = createExtractProcess({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      prompt: 'Extract tags',
      outputSchema: TagsSchema,
      apiKey: 'aiz-test',
    });

    const result = await proc.run('unsafe content', fakeCtx());
    expect(result.data).toBeNull();
    // Current mapProviderError has no 'safety' branch — message has no auth/rate/network keyword,
    // so it lands in the unknown fallback.
    expect(result.error?.code).toBe('provider_unknown');
    expect(result.error?.type).toBe('unknown');
    expect(result.error?.message).toContain('SAFETY');
  });
});

import type { PipelineContext, TraceContext } from '@idriszade/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiSource } from '../src/api-source.js';

const ItemSchema = z.object({ id: z.number(), name: z.string() });

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: new AbortController().signal,
    trace: NOOP_TRACE,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('createApiSource', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET success — single page, 3 items → 3 atoms via fetch()', async () => {
    const items = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
      { id: 3, name: 'gamma' },
    ];
    vi.stubGlobal('fetch', mockFetch(200, items));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(3);
    expect(result.data?.[0]?.object).toBe('atom');
    expect(result.data?.[0]?.data).toEqual({ id: 1, name: 'alpha' });
    expect(result.data?.[2]?.data).toEqual({ id: 3, name: 'gamma' });
  });

  it('POST success — method override', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [{ id: 10, name: 'post-item' }]));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/search',
      method: 'POST',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
  });

  it('Bearer auth — Authorization header set correctly', async () => {
    vi.stubGlobal('fetch', mockFetch(200, []));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      auth: { type: 'bearer', value: 'tok_secret' },
      schema: ItemSchema,
    });

    await source.fetch(undefined, makeCtx());

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_secret');
  });

  it('apiKey auth — custom header set', async () => {
    vi.stubGlobal('fetch', mockFetch(200, []));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      auth: { type: 'apiKey', header: 'X-Api-Key', value: 'key_abc123' },
      schema: ItemSchema,
    });

    await source.fetch(undefined, makeCtx());

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('key_abc123');
  });

  it('401 → SourceError with type: auth', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Unauthorized' }));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/protected',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.type).toBe('auth');
  });

  it('429 → type: rate_limited with retry_after_ms', async () => {
    vi.stubGlobal('fetch', mockFetch(429, { error: 'Too Many Requests' }, { 'Retry-After': '30' }));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.type).toBe('rate_limited');
    const rateLimitedErr = result.error as { type: 'rate_limited'; retry_after_ms?: number };
    expect(rateLimitedErr.retry_after_ms).toBe(30_000);
  });

  it('5xx → type: transient', async () => {
    vi.stubGlobal('fetch', mockFetch(503, { error: 'Service Unavailable' }));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
  });

  it('network error → type: network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('network');
  });

  it('basic auth — Authorization header set correctly', async () => {
    vi.stubGlobal('fetch', mockFetch(200, []));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      auth: { type: 'basic', user: 'alice', password: 'secret' },
      schema: ItemSchema,
    });

    await source.fetch(undefined, makeCtx());

    const fetchMock = vi.mocked(fetch);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('schema validation failure — invalid items are skipped, valid items returned', async () => {
    const items = [
      { id: 1, name: 'good' },
      { id: 'bad', name: 123 },
      { id: 2, name: 'also-good' },
    ];
    vi.stubGlobal('fetch', mockFetch(200, items));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.data.id).toBe(1);
    expect(result.data?.[1]?.data.id).toBe(2);
  });

  it('responsePath — extracts items from nested response', async () => {
    const body = { data: { results: [{ id: 1, name: 'nested' }] } };
    vi.stubGlobal('fetch', mockFetch(200, body));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      schema: ItemSchema,
      responseShape: 'wrapped',
      responsePath: 'data.results',
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.data).toEqual({ id: 1, name: 'nested' });
  });

  it('iter() returns same atoms as fetch() for single page', async () => {
    const items = [
      { id: 10, name: 'iter-a' },
      { id: 11, name: 'iter-b' },
    ];

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
    });

    vi.stubGlobal('fetch', mockFetch(200, items));
    const fetchResult = await source.fetch(undefined, makeCtx());

    vi.stubGlobal('fetch', mockFetch(200, items));
    const iterAtoms: { id: number; name: string }[] = [];
    for await (const a of source.iter(undefined, makeCtx())) {
      iterAtoms.push(a.data);
    }

    expect(iterAtoms).toEqual(fetchResult.data?.map((a) => a.data));
  });

  it('iter() returns early on HTTP error (does not throw)', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { error: 'Server Error' }));

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/data',
      schema: ItemSchema,
    });

    const atoms: unknown[] = [];
    for await (const a of source.iter(undefined, makeCtx())) {
      atoms.push(a);
    }
    expect(atoms).toHaveLength(0);
  });
});

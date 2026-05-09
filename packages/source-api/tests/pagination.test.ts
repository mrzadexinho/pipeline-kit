import type { PipelineContext, TraceContext } from '@idriszade/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiSource } from '../src/api-source.js';

const ItemSchema = z.object({ id: z.number() });

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

describe('pagination', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cursor pagination across 3 pages', async () => {
    const responses = [
      { ok: true, status: 200, body: { items: [{ id: 1 }, { id: 2 }], next_cursor: 'cur2' } },
      { ok: true, status: 200, body: { items: [{ id: 3 }, { id: 4 }], next_cursor: 'cur3' } },
      { ok: true, status: 200, body: { items: [{ id: 5 }], next_cursor: null } },
    ];
    let call = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const r = responses[call++]!;
        return Promise.resolve({
          ok: r.ok,
          status: r.status,
          headers: new Headers(),
          json: () => Promise.resolve(r.body),
          text: () => Promise.resolve(JSON.stringify(r.body)),
        });
      }),
    );

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
      responseShape: 'wrapped',
      paginate: { type: 'cursor', cursorField: 'next_cursor', cursorParam: 'cursor' },
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(5);
    expect(result.data?.map((a) => a.data.id)).toEqual([1, 2, 3, 4, 5]);
    expect(call).toBe(3);
  });

  it('offset pagination: page size 2, 5 total items → 3 requests', async () => {
    const allItems = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = new URL(url);
        const offset = Number(u.searchParams.get('offset') ?? '0');
        const limit = Number(u.searchParams.get('limit') ?? '2');
        const slice = allItems.slice(offset, offset + limit);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(slice),
          text: () => Promise.resolve(JSON.stringify(slice)),
        });
      }),
    );

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
      paginate: { type: 'offset', pageSize: 2, offsetParam: 'offset' },
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(5);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('page-based pagination across 2 pages', async () => {
    const pages: Record<number, { id: number }[]> = {
      1: [{ id: 1 }, { id: 2 }],
      2: [{ id: 3 }],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = new URL(url);
        const page = Number(u.searchParams.get('page') ?? '1');
        const body = pages[page] ?? [];
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      }),
    );

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
      paginate: { type: 'page', pageSize: 2, pageParam: 'page' },
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(3);
    expect(result.data?.map((a) => a.data.id)).toEqual([1, 2, 3]);
  });

  it('paginate: none — single fetch only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve([{ id: 1 }, { id: 2 }]),
        text: () => Promise.resolve('[{"id":1},{"id":2}]'),
      }),
    );

    const source = createApiSource({
      baseUrl: 'https://api.example.com',
      endpoint: '/items',
      schema: ItemSchema,
      paginate: { type: 'none' },
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

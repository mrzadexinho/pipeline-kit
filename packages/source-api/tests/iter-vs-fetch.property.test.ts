import type { PipelineContext, TraceContext } from '@pipeline-kit/core';
import fc from 'fast-check';
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

describe('iter() vs fetch() property test', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('iter and fetch produce same atom data in same order for arbitrary paginated mock', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(fc.nat({ max: 999 }), { minLength: 1, maxLength: 10 }), {
          minLength: 1,
          maxLength: 5,
        }),
        async (pages) => {
          let call = 0;

          vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => {
              const pageItems = pages[call]?.map((_id, idx) => ({ id: call * 10 + idx })) ?? [];
              const isLast = call >= pages.length - 1;
              call++;
              const body = {
                items: pageItems,
                next_cursor: isLast ? null : `cursor_${call}`,
              };
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
            responseShape: 'wrapped',
            paginate: { type: 'cursor', cursorField: 'next_cursor', cursorParam: 'cursor' },
          });

          const fetchResult = await source.fetch(undefined, makeCtx());
          expect(fetchResult.error).toBeNull();
          const fetchData = fetchResult.data?.map((a) => a.data);

          call = 0;
          vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(() => {
              const pageItems = pages[call]?.map((_id, idx) => ({ id: call * 10 + idx })) ?? [];
              const isLast = call >= pages.length - 1;
              call++;
              const body = {
                items: pageItems,
                next_cursor: isLast ? null : `cursor_${call}`,
              };
              return Promise.resolve({
                ok: true,
                status: 200,
                headers: new Headers(),
                json: () => Promise.resolve(body),
                text: () => Promise.resolve(JSON.stringify(body)),
              });
            }),
          );

          const iterData: { id: number }[] = [];
          for await (const atom of source.iter(undefined, makeCtx())) {
            iterData.push(atom.data);
          }

          expect(iterData).toEqual(fetchData);
        },
      ),
      { numRuns: 50 },
    );
  });
});

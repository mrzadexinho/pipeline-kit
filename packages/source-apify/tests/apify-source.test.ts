import type { PipelineContext, TraceContext } from '@idriszade/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ItemSchema = z.object({ id: z.number(), name: z.string() });
type Item = z.infer<typeof ItemSchema>;

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(signal?: AbortSignal): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: signal ?? new AbortController().signal,
    trace: NOOP_TRACE,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

/** Build a minimal mock ApifyClient that controls actor start, run polling, and dataset items. */
function buildMockClient(opts: {
  startedRunId?: string;
  runStatus?: string;
  datasetId?: string;
  datasetItems?: unknown[];
  startThrows?: boolean;
}) {
  const {
    startedRunId = 'run-abc',
    runStatus = 'SUCCEEDED',
    datasetId = 'ds-abc',
    datasetItems = [],
    startThrows = false,
  } = opts;

  const listItems = vi.fn().mockResolvedValue({
    items: datasetItems,
    total: datasetItems.length,
    count: datasetItems.length,
    offset: 0,
    limit: datasetItems.length,
    desc: false,
  });

  const datasetClientMock = { listItems };

  const getRunMock = vi.fn().mockResolvedValue({
    id: startedRunId,
    status: runStatus,
    defaultDatasetId: datasetId,
  });

  const startMock = startThrows
    ? vi.fn().mockRejectedValue(new Error('start failed'))
    : vi
        .fn()
        .mockResolvedValue({ id: startedRunId, status: 'RUNNING', defaultDatasetId: datasetId });

  const runClientMock = { get: getRunMock };

  const instance = {
    actor: vi.fn().mockReturnValue({ start: startMock }),
    run: vi.fn().mockReturnValue(runClientMock),
    dataset: vi.fn().mockReturnValue(datasetClientMock),
  };
  // Must use `function` keyword so Vitest treats it as a constructable mock
  // biome-ignore lint/complexity/useArrowFunction: required for new-able mock
  const MockApifyClient = vi.fn().mockImplementation(function () {
    return instance;
  });

  return { MockApifyClient, startMock, getRunMock, listItems };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createApifySource', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SUCCEEDED run with 3 dataset items → 3 atoms emitted via fetch()', async () => {
    const items: Item[] = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
      { id: 3, name: 'gamma' },
    ];

    const { MockApifyClient } = buildMockClient({ datasetItems: items });

    vi.doMock('apify-client', () => ({ ApifyClient: MockApifyClient }));
    const { createApifySource: create } = await import('../src/apify-source.js');

    const source = create({
      actorId: 'test/actor',
      input: { url: 'https://example.com' },
      schema: ItemSchema,
      apifyToken: 'tok_test',
      pollIntervalMs: 1,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(3);
    expect(result.data?.[0]?.object).toBe('atom');
    expect(result.data?.[0]?.data).toEqual({ id: 1, name: 'alpha' });
    expect(result.data?.[2]?.data).toEqual({ id: 3, name: 'gamma' });
  });

  it('FAILED run status → SourceError { type: transient }', async () => {
    const { MockApifyClient } = buildMockClient({ runStatus: 'FAILED' });

    vi.doMock('apify-client', () => ({ ApifyClient: MockApifyClient }));
    const { createApifySource: create } = await import('../src/apify-source.js');

    const source = create({
      actorId: 'test/actor',
      input: {},
      schema: ItemSchema,
      apifyToken: 'tok_test',
      pollIntervalMs: 1,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
  });

  it('TIMED-OUT run status → SourceError { type: transient }', async () => {
    const { MockApifyClient } = buildMockClient({ runStatus: 'TIMED-OUT' });

    vi.doMock('apify-client', () => ({ ApifyClient: MockApifyClient }));
    const { createApifySource: create } = await import('../src/apify-source.js');

    const source = create({
      actorId: 'test/actor',
      input: {},
      schema: ItemSchema,
      apifyToken: 'tok_test',
      pollIntervalMs: 1,
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
  });

  it('schema validation failure on one of 3 items → skip bad item, yield 2 atoms', async () => {
    const items = [
      { id: 1, name: 'good' },
      { id: 'bad', name: 999 }, // fails schema
      { id: 2, name: 'also-good' },
    ];

    const { MockApifyClient } = buildMockClient({ datasetItems: items });

    vi.doMock('apify-client', () => ({ ApifyClient: MockApifyClient }));
    const { createApifySource: create } = await import('../src/apify-source.js');

    const source = create({
      actorId: 'test/actor',
      input: {},
      schema: ItemSchema,
      apifyToken: 'tok_test',
      pollIntervalMs: 1,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await source.fetch(undefined, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.data.id).toBe(1);
    expect(result.data?.[1]?.data.id).toBe(2);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it('cancellation mid-poll: ctx.signal.abort() while waiting → iter exits cleanly', async () => {
    // Run will stay RUNNING forever; we abort the context signal after start
    const getRunMock = vi.fn().mockImplementation(async () => {
      return { id: 'run-abc', status: 'RUNNING', defaultDatasetId: 'ds-abc' };
    });

    const startMock = vi
      .fn()
      .mockResolvedValue({ id: 'run-abc', status: 'RUNNING', defaultDatasetId: 'ds-abc' });

    const cancelInstance = {
      actor: vi.fn().mockReturnValue({ start: startMock }),
      run: vi.fn().mockReturnValue({ get: getRunMock }),
      dataset: vi.fn().mockReturnValue({ listItems: vi.fn() }),
    };
    // Must use `function` keyword so Vitest treats it as a constructable mock
    // biome-ignore lint/complexity/useArrowFunction: required for new-able mock
    const MockApifyClient = vi.fn().mockImplementation(function () {
      return cancelInstance;
    });

    vi.doMock('apify-client', () => ({ ApifyClient: MockApifyClient }));
    const { createApifySource: create } = await import('../src/apify-source.js');

    const ac = new AbortController();
    const source = create({
      actorId: 'test/actor',
      input: {},
      schema: ItemSchema,
      apifyToken: 'tok_test',
      pollIntervalMs: 5,
    });

    const ctx = makeCtx(ac.signal);

    // Abort after the first poll check so we know we entered the loop
    const iterPromise = (async () => {
      const atoms: unknown[] = [];
      for await (const a of source.iter(undefined, ctx)) {
        atoms.push(a);
      }
      return atoms;
    })();

    // Let one poll cycle fire, then abort
    await new Promise<void>((r) => setTimeout(r, 15));
    ac.abort();

    const atoms = await iterPromise;
    expect(atoms).toHaveLength(0);
  });
});

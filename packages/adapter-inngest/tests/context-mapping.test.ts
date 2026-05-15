import { describe, expect, it } from 'vitest';
import { mapInngestContext } from '../src/context-mapping.js';

const BASE_OPTS = {
  runId: 'pk_run_test01',
  pipelineId: 'pk_pipe_demo',
} as const;

describe('mapInngestContext', () => {
  it('populates attempt from event', () => {
    const ctx = mapInngestContext({ attempt: 2 }, BASE_OPTS);
    expect(ctx.attempt).toBe(2);
  });

  it('creates AbortSignal that is not yet aborted', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    expect(ctx.signal).toBeDefined();
    expect(ctx.signal.aborted).toBe(false);
  });

  it('passes runId and pipelineId from opts', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    expect(ctx.runId).toBe('pk_run_test01');
    expect(ctx.pipelineId).toBe('pk_pipe_demo');
  });

  it('passes idempotencyKey from opts when provided', () => {
    const ctx = mapInngestContext(
      { attempt: 0 },
      { ...BASE_OPTS, idempotencyKey: 'idem-abc' },
    );
    expect(ctx.idempotencyKey).toBe('idem-abc');
  });

  it('idempotencyKey is undefined when not provided', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    expect(ctx.idempotencyKey).toBeUndefined();
  });

  it('creates a fresh UsageAccumulator with no recorded metrics', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    expect(ctx.usage).toBeDefined();
    expect(ctx.usage.getAll().size).toBe(0);
  });

  it('defaults deps to empty object when not provided', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    expect(ctx.deps).toEqual({});
  });

  it('passes deps through from opts', () => {
    const deps = { db: { query: () => null } };
    const ctx = mapInngestContext({ attempt: 0 }, { ...BASE_OPTS, deps });
    expect(ctx.deps).toEqual(deps);
  });

  it('attachMetadata adds key to metadata', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    ctx.attachMetadata('source', 'inngest');
    expect(ctx.metadata['source']).toBe('inngest');
  });

  it('attachMetadata supports multiple keys', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    ctx.attachMetadata('a', 1);
    ctx.attachMetadata('b', 2);
    expect(ctx.metadata['a']).toBe(1);
    expect(ctx.metadata['b']).toBe(2);
  });

  it('trace is defined (defaults to ROOT_CONTEXT) when no traceparent in event data', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    // trace is always an OTel Context object — just verify it exists
    expect(ctx.trace).toBeDefined();
  });

  it('trace is defined when event.data has traceparent', () => {
    const ctx = mapInngestContext(
      {
        attempt: 0,
        data: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          tracestate: 'vendor=value',
        },
      },
      BASE_OPTS,
    );
    // OTel Context is always returned; the propagator (if registered) would restore span context.
    // Without a propagator registered in this test environment the object is still valid.
    expect(ctx.trace).toBeDefined();
  });

  it('trace is defined when event.data is absent', () => {
    const ctx = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    expect(ctx.trace).toBeDefined();
  });

  it('each call produces an independent context (no shared state)', () => {
    const ctx1 = mapInngestContext({ attempt: 0 }, BASE_OPTS);
    const ctx2 = mapInngestContext({ attempt: 1 }, BASE_OPTS);
    ctx1.attachMetadata('x', 'ctx1');
    expect(ctx2.metadata['x']).toBeUndefined();
  });
});

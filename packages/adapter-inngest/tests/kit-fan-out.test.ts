import { describe, expect, it, vi } from 'vitest';
import type { StepTools } from '../src/create-kit-function.js';
import { kitFanOut } from '../src/kit-fan-out.js';

const childFn = { id: 'child-function' } as unknown;

function makeStep(opts?: {
  invokeResults?: Array<unknown | Error>;
}): StepTools {
  const { invokeResults = [] } = opts ?? {};
  let invokeCallCount = 0;

  return {
    run: vi.fn(async (_id: string, fn: () => unknown) => fn()),
    invoke: vi.fn(async (_id: string, _opts: { function: unknown; data: unknown }) => {
      const result = invokeResults[invokeCallCount++];
      if (result instanceof Error) throw result;
      return result;
    }),
    waitForEvent: vi.fn(),
    sendEvent: vi.fn(),
  };
}

describe('kitFanOut', () => {
  it('memoizes items via step.run (replay-safety)', async () => {
    const step = makeStep({ invokeResults: ['a', 'b'] });
    await kitFanOut(step, { childFunction: childFn, items: ['x', 'y'] });
    expect(step.run).toHaveBeenCalledOnce();
    expect(step.run).toHaveBeenCalledWith('fan-out-source', expect.any(Function));
  });

  it('invokes step.invoke for each item', async () => {
    const step = makeStep({ invokeResults: [1, 2, 3] });
    await kitFanOut(step, { childFunction: childFn, items: [10, 20, 30] });
    expect(step.invoke).toHaveBeenCalledTimes(3);
  });

  it('returns Result.ok for successful invocations', async () => {
    const step = makeStep({ invokeResults: ['output-a', 'output-b'] });
    const results = await kitFanOut(step, { childFunction: childFn, items: ['a', 'b'] });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ data: 'output-a', error: null });
    expect(results[1]).toEqual({ data: 'output-b', error: null });
  });

  it('returns Result.err for a failed invocation (not rejection)', async () => {
    const step = makeStep({ invokeResults: [new Error('child boom')] });
    const results = await kitFanOut(step, { childFunction: childFn, items: ['x'] });
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r?.error).not.toBeNull();
    expect(r?.data).toBeNull();
    expect(r?.error?.type).toBe('stage_error');
    expect(r?.error?.code).toBe('process_failed');
    expect(r?.error?.message).toContain('Fan-out child 0 failed: child boom');
  });

  it('handles mixed success and failure across items', async () => {
    const step = makeStep({
      invokeResults: ['ok-output', new Error('item 1 failed'), 'ok-output-2'],
    });
    const results = await kitFanOut(step, { childFunction: childFn, items: ['a', 'b', 'c'] });
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ data: 'ok-output', error: null });
    expect(results[1]?.data).toBeNull();
    expect(results[1]?.error?.message).toContain('Fan-out child 1 failed');
    expect(results[2]).toEqual({ data: 'ok-output-2', error: null });
  });

  it('uses custom sourceId when provided', async () => {
    const step = makeStep({ invokeResults: ['r'] });
    await kitFanOut(step, { childFunction: childFn, items: ['x'], sourceId: 'my-source-id' });
    expect(step.run).toHaveBeenCalledWith('my-source-id', expect.any(Function));
  });

  it('uses default sourceId "fan-out-source" when not provided', async () => {
    const step = makeStep({ invokeResults: ['r'] });
    await kitFanOut(step, { childFunction: childFn, items: ['x'] });
    expect(step.run).toHaveBeenCalledWith('fan-out-source', expect.any(Function));
  });

  it('invokes with correct function reference and data', async () => {
    const step = makeStep({ invokeResults: ['out'] });
    await kitFanOut(step, { childFunction: childFn, items: ['item-data'] });
    expect(step.invoke).toHaveBeenCalledWith('fan-out-0', {
      function: childFn,
      data: 'item-data',
    });
  });
});

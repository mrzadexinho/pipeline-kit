import { ok } from '@idriszade/core';
import { describe, expect, it, vi } from 'vitest';
import { createKitFunction } from '../src/create-kit-function.js';
import { kitStep } from '../src/kit-step.js';

describe('integration: createKitFunction + kitStep', () => {
  it('end-to-end: creates function, runs handler with kitStep', async () => {
    // Mock inngest client
    let capturedHandler: (args: { event: unknown; step: unknown }) => Promise<unknown>;
    const mockInngest = {
      createFunction: (_config: unknown, _trigger: unknown, handler: typeof capturedHandler) => {
        capturedHandler = handler;
        return { __test: 'mock-fn' };
      },
    };

    const handlerSpy = vi.fn(
      async ({
        step,
      }: {
        step: { run: <R>(id: string, fn: () => R | Promise<R>) => Promise<R> };
      }) => {
        // Use kitStep inside the handler — the real integration point
        const result = await kitStep(step, 'test-step', async () => ok('processed'));
        return result;
      },
    );

    const fn = createKitFunction(
      mockInngest as { createFunction: (...args: unknown[]) => unknown },
      {
        id: 'test-fn',
        trigger: { kind: 'event', name: 'test.event' },
      },
      handlerSpy as Parameters<typeof createKitFunction>[2],
    );

    expect(fn).toEqual({ __test: 'mock-fn' });

    // Simulate Inngest invoking the function
    const mockStep = {
      run: async (_id: string, fn: () => unknown) => fn(),
      invoke: vi.fn(),
      waitForEvent: vi.fn(),
      sendEvent: vi.fn(),
    };

    const result = await capturedHandler?.({
      event: { data: {}, attempt: 0 },
      step: mockStep,
    });

    expect(handlerSpy).toHaveBeenCalledOnce();
    expect(result).toBe('processed');
  });

  it('trigger mapping: event kind produces { event: name }', () => {
    const mockInngest = {
      createFunction: (_config: unknown, trigger: unknown, _handler: unknown) => trigger,
    };

    const trigger = createKitFunction(
      mockInngest as { createFunction: (...args: unknown[]) => unknown },
      { id: 'test-event-fn', trigger: { kind: 'event', name: 'app/order.placed' } },
      async () => undefined,
    );

    expect(trigger).toEqual({ event: 'app/order.placed' });
  });

  it('trigger mapping: cron kind produces { cron: expr }', () => {
    const mockInngest = {
      createFunction: (_config: unknown, trigger: unknown, _handler: unknown) => trigger,
    };

    const trigger = createKitFunction(
      mockInngest as { createFunction: (...args: unknown[]) => unknown },
      { id: 'test-cron-fn', trigger: { kind: 'cron', expr: '0 9 * * 1-5' } },
      async () => undefined,
    );

    expect(trigger).toEqual({ cron: '0 9 * * 1-5' });
  });

  it('handler receives a valid PipelineContext when invoked', async () => {
    let capturedHandler: (args: { event: unknown; step: unknown }) => Promise<unknown>;
    const mockInngest = {
      createFunction: (_config: unknown, _trigger: unknown, handler: typeof capturedHandler) => {
        capturedHandler = handler;
        return {};
      },
    };

    let receivedCtx: Record<string, unknown> | undefined;
    createKitFunction(
      mockInngest as { createFunction: (...args: unknown[]) => unknown },
      { id: 'ctx-check-fn', trigger: { kind: 'manual' } },
      async ({ ctx }) => {
        receivedCtx = ctx as Record<string, unknown>;
      },
    );

    const mockStep = {
      run: vi.fn(),
      invoke: vi.fn(),
      waitForEvent: vi.fn(),
      sendEvent: vi.fn(),
    };

    await capturedHandler?.({ event: { data: {}, attempt: 2 }, step: mockStep });

    expect(receivedCtx).toBeDefined();
    expect(typeof receivedCtx?.runId).toBe('string');
    expect((receivedCtx?.runId as string).startsWith('pk_run_')).toBe(true);
    expect(receivedCtx?.pipelineId).toBe('ctx-check-fn');
    expect(receivedCtx?.attempt).toBe(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { KitFunctionConfig, StepTools } from '../src/create-kit-function.js';
import {
  buildFunctionConfig,
  createKitFunction,
  mapTriggerConfig,
} from '../src/create-kit-function.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeInngest() {
  // Capture the handler so tests can invoke it directly.
  let capturedHandler: ((args: { event: unknown; step: StepTools }) => Promise<unknown>) | null =
    null;
  let capturedConfig: Record<string, unknown> | null = null;
  let capturedTrigger: unknown = null;

  const createFunction = vi.fn(
    (
      config: Record<string, unknown>,
      trigger: unknown,
      handler: (args: { event: unknown; step: StepTools }) => Promise<unknown>,
    ) => {
      capturedConfig = config;
      capturedTrigger = trigger;
      capturedHandler = handler;
      return { _inngestFunction: true };
    },
  );

  return {
    inngest: { createFunction } as unknown as { createFunction: (...args: unknown[]) => unknown },
    createFunction,
    getHandler: () => capturedHandler,
    getConfig: () => capturedConfig,
    getTrigger: () => capturedTrigger,
  };
}

function makeStep(): StepTools {
  return {
    run: vi.fn(async (_id: string, fn: () => unknown) => fn()),
    invoke: vi.fn(async () => ({})),
    waitForEvent: vi.fn(async () => null),
    sendEvent: vi.fn(async () => ({})),
  };
}

function makeEvent(overrides: Partial<{ data: unknown; attempt: number }> = {}) {
  return { data: {}, attempt: 0, ...overrides };
}

const BASE_CONFIG: KitFunctionConfig = {
  id: 'test-pipeline',
  trigger: { kind: 'event', name: 'app/user.created' },
};

// ──────────────────────────────────────────────────────────────────────────────
// createKitFunction — integration behaviour
// ──────────────────────────────────────────────────────────────────────────────

describe('createKitFunction', () => {
  it('calls inngest.createFunction with the correct id', () => {
    const { inngest, createFunction } = makeInngest();
    createKitFunction(inngest, BASE_CONFIG, async () => 'ok');
    expect(createFunction).toHaveBeenCalledOnce();
    const config = createFunction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.id).toBe('test-pipeline');
  });

  it('returns the value from inngest.createFunction', () => {
    const { inngest } = makeInngest();
    const result = createKitFunction(inngest, BASE_CONFIG, async () => 'ok');
    expect(result).toEqual({ _inngestFunction: true });
  });

  it('handler receives ctx with correct pipelineId', async () => {
    const { inngest, getHandler } = makeInngest();

    let receivedPipelineId: string | undefined;
    createKitFunction(inngest, BASE_CONFIG, async ({ ctx }) => {
      receivedPipelineId = ctx.pipelineId;
    });

    // biome-ignore lint/style/noNonNullAssertion: handler is guaranteed non-null after createKitFunction registers it
    const handler = getHandler()!;
    await handler({ event: makeEvent(), step: makeStep() });

    expect(receivedPipelineId).toBe('test-pipeline');
  });

  it('handler receives ctx with attempt matching the event', async () => {
    const { inngest, getHandler } = makeInngest();

    let receivedAttempt: number | undefined;
    createKitFunction(inngest, BASE_CONFIG, async ({ ctx }) => {
      receivedAttempt = ctx.attempt;
    });

    // biome-ignore lint/style/noNonNullAssertion: handler is guaranteed non-null after createKitFunction registers it
    const handler = getHandler()!;
    await handler({ event: makeEvent({ attempt: 3 }), step: makeStep() });

    expect(receivedAttempt).toBe(3);
  });

  it('handler receives ctx.runId prefixed with pk_run_', async () => {
    const { inngest, getHandler } = makeInngest();

    let receivedRunId: string | undefined;
    createKitFunction(inngest, BASE_CONFIG, async ({ ctx }) => {
      receivedRunId = ctx.runId;
    });

    // biome-ignore lint/style/noNonNullAssertion: handler is guaranteed non-null after createKitFunction registers it
    const handler = getHandler()!;
    await handler({ event: makeEvent(), step: makeStep() });

    expect(receivedRunId).toMatch(/^pk_run_/);
  });

  it('disposes registry in finally block even when handler throws', async () => {
    const { inngest, getHandler } = makeInngest();

    createKitFunction(inngest, BASE_CONFIG, async () => {
      throw new Error('handler blew up');
    });

    // biome-ignore lint/style/noNonNullAssertion: handler is guaranteed non-null after createKitFunction registers it
    const handler = getHandler()!;
    // Should not suppress the error — just ensure disposal runs.
    await expect(handler({ event: makeEvent(), step: makeStep() })).rejects.toThrow(
      'handler blew up',
    );
  });

  it('handler receives the raw event object', async () => {
    const { inngest, getHandler } = makeInngest();

    let receivedEvent: unknown;
    createKitFunction(inngest, BASE_CONFIG, async ({ event }) => {
      receivedEvent = event;
    });

    // biome-ignore lint/style/noNonNullAssertion: handler is guaranteed non-null after createKitFunction registers it
    const handler = getHandler()!;
    const event = makeEvent({ data: { foo: 'bar' }, attempt: 1 });
    await handler({ event, step: makeStep() });

    expect((receivedEvent as { data: { foo: string } }).data.foo).toBe('bar');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mapTriggerConfig
// ──────────────────────────────────────────────────────────────────────────────

describe('mapTriggerConfig', () => {
  it('maps cron → { cron: expr }', () => {
    expect(mapTriggerConfig({ kind: 'cron', expr: '0 9 * * 1-5' })).toEqual({
      cron: '0 9 * * 1-5',
    });
  });

  it('maps webhook → { event: "webhook<path>" }', () => {
    expect(mapTriggerConfig({ kind: 'webhook', path: '/payments/stripe' })).toEqual({
      event: 'webhook/payments/stripe',
    });
  });

  it('maps event → { event: name }', () => {
    expect(mapTriggerConfig({ kind: 'event', name: 'app/order.placed' })).toEqual({
      event: 'app/order.placed',
    });
  });

  it('maps manual → { event: "manual/trigger" }', () => {
    expect(mapTriggerConfig({ kind: 'manual' })).toEqual({ event: 'manual/trigger' });
  });

  it('maps mcp → { event: "mcp/<toolName>" }', () => {
    expect(mapTriggerConfig({ kind: 'mcp', toolName: 'analyze-pr' })).toEqual({
      event: 'mcp/analyze-pr',
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// buildFunctionConfig
// ──────────────────────────────────────────────────────────────────────────────

describe('buildFunctionConfig', () => {
  it('always includes the id', () => {
    const cfg = buildFunctionConfig({ id: 'my-fn', trigger: { kind: 'manual' } });
    expect(cfg.id).toBe('my-fn');
  });

  it('omits retries when not provided', () => {
    const cfg = buildFunctionConfig({ id: 'x', trigger: { kind: 'manual' } });
    expect(cfg.retries).toBeUndefined();
  });

  it('includes retries when provided', () => {
    const cfg = buildFunctionConfig({ id: 'x', trigger: { kind: 'manual' }, retries: 5 });
    expect(cfg.retries).toBe(5);
  });

  it('maps RunGuard.concurrency (queue overflow) to Inngest concurrency array without key', () => {
    const cfg = buildFunctionConfig({
      id: 'x',
      trigger: { kind: 'manual' },
      runGuard: { concurrency: { limit: 10, overflow: 'queue' } },
    });
    expect(cfg.concurrency).toEqual([{ limit: 10 }]);
  });

  it('maps RunGuard.concurrency (reject overflow) to Inngest singleton primitive (ADR IV-5 shape 4)', () => {
    const cfg = buildFunctionConfig({
      id: 'x',
      trigger: { kind: 'manual' },
      runGuard: { concurrency: { limit: 3, overflow: 'reject' } },
    });
    // True singleton: skip overlapping runs — uses Inngest singleton, NOT concurrency array
    expect(cfg.singleton).toEqual({ key: 'event.data.pipelineId', mode: 'skip' });
    expect(cfg.concurrency).toBeUndefined();
  });

  it('maps RunGuard.concurrency (no overflow) without key', () => {
    const cfg = buildFunctionConfig({
      id: 'x',
      trigger: { kind: 'manual' },
      runGuard: { concurrency: { limit: 5 } },
    });
    expect(cfg.concurrency).toEqual([{ limit: 5 }]);
  });

  it('maps RunGuard.dedup to Inngest idempotency expression + throttle with period (ADR IV-5 shape 5)', () => {
    const cfg = buildFunctionConfig({
      id: 'x',
      trigger: { kind: 'manual' },
      runGuard: { dedup: { period: '24h' } },
    });
    expect(cfg.idempotency).toBe('event.data.dedupKey');
    expect(cfg.throttle).toEqual({ limit: 1, period: '24h', key: 'event.data.dedupKey' });
  });

  it('idempotency is set unconditionally (IV-6: Inngest treats undefined dedupKey as no-op)', () => {
    const cfg = buildFunctionConfig({ id: 'x', trigger: { kind: 'manual' } });
    expect(cfg.idempotency).toBe('event.data.dedupKey');
  });

  it('omits concurrency, singleton, and throttle when no runGuard', () => {
    const cfg = buildFunctionConfig({ id: 'x', trigger: { kind: 'manual' } });
    expect(cfg.concurrency).toBeUndefined();
    expect(cfg.singleton).toBeUndefined();
    expect(cfg.throttle).toBeUndefined();
  });
});

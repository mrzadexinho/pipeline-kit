import { describe, expect, it, vi } from 'vitest';
import type { KitTriggerEnvelope, TriggerConfig } from '@idriszade/core';
import { InngestTriggerAdapter } from '../src/inngest-trigger-adapter.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

type CapturedCall = {
  config: Record<string, unknown>;
  trigger: unknown;
  handler: (args: { event: Record<string, unknown> }) => Promise<void>;
};

function makeMockInngest() {
  const calls: CapturedCall[] = [];

  const createFunction = vi.fn(
    (
      config: Record<string, unknown>,
      trigger: unknown,
      handler: (args: { event: Record<string, unknown> }) => Promise<void>,
    ) => {
      calls.push({ config, trigger, handler });
      return { _fn: true, config, trigger };
    },
  );

  return {
    inngest: { createFunction } as unknown as { createFunction: (...args: unknown[]) => unknown },
    createFunction,
    calls,
  };
}

function makeEvent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'evt_test_123',
    ts: Date.now(),
    name: 'test/event',
    data: {},
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// register — trigger kind mapping
// ──────────────────────────────────────────────────────────────────────────────

describe('InngestTriggerAdapter — register trigger mapping', () => {
  it('maps cron to { cron: expr }', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.register({ kind: 'cron', expr: '0 9 * * 1-5' }, async () => {});
    expect(calls[0]?.trigger).toEqual({ cron: '0 9 * * 1-5' });
  });

  it('maps webhook to { event: "webhook<path>" }', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.register({ kind: 'webhook', path: '/payments/stripe' }, async () => {});
    expect(calls[0]?.trigger).toEqual({ event: 'webhook/payments/stripe' });
  });

  it('maps event to { event: name }', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.register({ kind: 'event', name: 'app/order.placed' }, async () => {});
    expect(calls[0]?.trigger).toEqual({ event: 'app/order.placed' });
  });

  it('maps manual to { event: "manual/trigger" }', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.register({ kind: 'manual' }, async () => {});
    expect(calls[0]?.trigger).toEqual({ event: 'manual/trigger' });
  });

  it('maps mcp to { event: "mcp/<toolName>" }', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.register({ kind: 'mcp', toolName: 'analyze-pr' }, async () => {});
    expect(calls[0]?.trigger).toEqual({ event: 'mcp/analyze-pr' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// register — KitTriggerEnvelope construction
// ──────────────────────────────────────────────────────────────────────────────

describe('InngestTriggerAdapter — KitTriggerEnvelope', () => {
  it('passes id from event when present', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'event', name: 'app/test' }, async (env) => {
      received = env;
    });

    await calls[0]!.handler({ event: makeEvent({ id: 'evt_abc' }) });
    expect(received?.id).toBe('evt_abc');
  });

  it('generates a UUID when event has no id', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'event', name: 'app/test' }, async (env) => {
      received = env;
    });

    const event = makeEvent();
    delete event['id'];
    await calls[0]!.handler({ event });
    expect(typeof received?.id).toBe('string');
    expect(received!.id.length).toBeGreaterThan(0);
  });

  it('sets type from trigger kind', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'manual' }, async (env) => {
      received = env;
    });

    await calls[0]!.handler({ event: makeEvent() });
    expect(received?.type).toBe('manual');
  });

  it('always sets source to "inngest"', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'event', name: 'x' }, async (env) => {
      received = env;
    });

    await calls[0]!.handler({ event: makeEvent() });
    expect(received?.source).toBe('inngest');
  });

  it('sets time as ISO string derived from event.ts', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'event', name: 'x' }, async (env) => {
      received = env;
    });

    const ts = 1700000000000;
    await calls[0]!.handler({ event: makeEvent({ ts }) });
    expect(received?.time).toBe(new Date(ts).toISOString());
  });

  it('passes event.data as envelope data', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<{ foo: string }> | undefined;

    await adapter.register<{ foo: string }>({ kind: 'event', name: 'x' }, async (env) => {
      received = env;
    });

    await calls[0]!.handler({ event: makeEvent({ data: { foo: 'bar' } }) });
    expect(received?.data.foo).toBe('bar');
  });

  it('includes dedupKey when present in event.data', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'event', name: 'x' }, async (env) => {
      received = env;
    });

    await calls[0]!.handler({ event: makeEvent({ data: { dedupKey: 'key-abc' } }) });
    expect(received?.dedupKey).toBe('key-abc');
  });

  it('omits dedupKey when not in event.data', async () => {
    const { inngest, calls } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    let received: KitTriggerEnvelope<unknown> | undefined;

    await adapter.register({ kind: 'event', name: 'x' }, async (env) => {
      received = env;
    });

    await calls[0]!.handler({ event: makeEvent({ data: {} }) });
    expect(received?.dedupKey).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// start / stop lifecycle
// ──────────────────────────────────────────────────────────────────────────────

describe('InngestTriggerAdapter — lifecycle', () => {
  it('started is false before start()', () => {
    const { inngest } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    expect(adapter.started).toBe(false);
  });

  it('started is true after start()', async () => {
    const { inngest } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.start();
    expect(adapter.started).toBe(true);
  });

  it('started is false after stop()', async () => {
    const { inngest } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    await adapter.start();
    await adapter.stop();
    expect(adapter.started).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// functions getter
// ──────────────────────────────────────────────────────────────────────────────

describe('InngestTriggerAdapter — functions getter', () => {
  it('returns empty array before any registrations', () => {
    const { inngest } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    expect(adapter.functions).toEqual([]);
  });

  it('returns registered functions after register()', async () => {
    const { inngest } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);
    const configs: TriggerConfig[] = [
      { kind: 'event', name: 'a' },
      { kind: 'manual' },
    ];
    for (const cfg of configs) {
      await adapter.register(cfg, async () => {});
    }
    expect(adapter.functions.length).toBe(2);
  });

  it('accumulates functions across multiple registrations', async () => {
    const { inngest } = makeMockInngest();
    const adapter = new InngestTriggerAdapter(inngest);

    await adapter.register({ kind: 'cron', expr: '0 * * * *' }, async () => {});
    expect(adapter.functions.length).toBe(1);

    await adapter.register({ kind: 'event', name: 'x' }, async () => {});
    expect(adapter.functions.length).toBe(2);

    await adapter.register({ kind: 'webhook', path: '/hook' }, async () => {});
    expect(adapter.functions.length).toBe(3);
  });
});

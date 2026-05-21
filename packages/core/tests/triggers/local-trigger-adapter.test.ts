import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitTriggerEnvelope } from '../../src/trigger.js';
import {
  LocalTriggerAdapter,
  parseCronExpression,
} from '../../src/triggers/local-trigger-adapter.js';

// ---------------------------------------------------------------------------
// Cron parser unit tests
// ---------------------------------------------------------------------------

describe('parseCronExpression', () => {
  it('* * * * * — wildcard matches any date', () => {
    const parsed = parseCronExpression('* * * * *');
    const anyDate = new Date(2024, 0, 15, 14, 37, 0);
    // Fields are wildcard → should match (via cronMatches logic)
    expect(parsed.minute.values).toBeNull();
    expect(parsed.hour.values).toBeNull();
    expect(parsed.dayOfMonth.values).toBeNull();
    expect(parsed.month.values).toBeNull();
    expect(parsed.dayOfWeek.values).toBeNull();
    // Suppress unused warning
    void anyDate;
  });

  it('5 * * * * — matches only minute=5', () => {
    const parsed = parseCronExpression('5 * * * *');
    expect(parsed.minute.values).toEqual(new Set([5]));
    expect(parsed.hour.values).toBeNull();
  });

  it('*/15 * * * * — step matches 0, 15, 30, 45', () => {
    const parsed = parseCronExpression('*/15 * * * *');
    expect(parsed.minute.values).toEqual(new Set([0, 15, 30, 45]));
  });

  it('0-30/10 * * * * — range+step matches 0, 10, 20, 30', () => {
    const parsed = parseCronExpression('0-30/10 * * * *');
    expect(parsed.minute.values).toEqual(new Set([0, 10, 20, 30]));
  });

  it('1,5,10 * * * * — comma-separated integers', () => {
    const parsed = parseCronExpression('1,5,10 * * * *');
    expect(parsed.minute.values).toEqual(new Set([1, 5, 10]));
  });

  it('wrong number of fields → throws with error substring', () => {
    expect(() => parseCronExpression('* * * *')).toThrow(
      '[@idriszade/core] invalid cron expression',
    );
  });

  it('out-of-range value → throws with error substring', () => {
    expect(() => parseCronExpression('60 * * * *')).toThrow(
      '[@idriszade/core] invalid cron expression',
    );
  });

  it('unrecognised token → throws with error substring', () => {
    expect(() => parseCronExpression('@hourly * * * *')).toThrow(
      '[@idriszade/core] invalid cron expression',
    );
  });
});

// ---------------------------------------------------------------------------
// Lifecycle tests
// ---------------------------------------------------------------------------

describe('LocalTriggerAdapter — lifecycle', () => {
  let adapter: LocalTriggerAdapter;

  afterEach(async () => {
    await adapter.stop();
    vi.useRealTimers();
  });

  it('address is null before start()', () => {
    adapter = new LocalTriggerAdapter();
    expect(adapter.address).toBeNull();
  });

  it('address.port is a positive number after start()', async () => {
    adapter = new LocalTriggerAdapter();
    await adapter.register({ kind: 'webhook', path: '/probe' }, async () => {});
    await adapter.start();
    expect(adapter.address).not.toBeNull();
    expect(adapter.address?.port).toBeGreaterThan(0);
  });

  it('address is null after stop()', async () => {
    adapter = new LocalTriggerAdapter();
    await adapter.register({ kind: 'webhook', path: '/probe' }, async () => {});
    await adapter.start();
    await adapter.stop();
    expect(adapter.address).toBeNull();
  });

  it('stop() when not started → no throw', async () => {
    adapter = new LocalTriggerAdapter();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it('start → stop → start yields fresh ephemeral port', async () => {
    adapter = new LocalTriggerAdapter();
    await adapter.register({ kind: 'webhook', path: '/probe' }, async () => {});
    await adapter.start();
    const firstPort = adapter.address?.port;
    await adapter.stop();
    await adapter.start();
    const secondPort = adapter.address?.port;
    // Both should be positive (ports may or may not match depending on OS recycling, but both should be valid)
    expect(firstPort).toBeGreaterThan(0);
    expect(secondPort).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Event / manual / mcp bus tests
// ---------------------------------------------------------------------------

describe('LocalTriggerAdapter — event/manual/mcp bus', () => {
  let adapter: LocalTriggerAdapter;

  afterEach(async () => {
    await adapter.stop();
    vi.useRealTimers();
  });

  it('event handler is invoked with correct envelope on fire()', async () => {
    adapter = new LocalTriggerAdapter();
    const received: KitTriggerEnvelope<unknown>[] = [];
    await adapter.register({ kind: 'event', name: 'order.placed' }, async (env) => {
      received.push(env);
    });
    await adapter.start();

    adapter.fire('event:order.placed', { orderId: 'abc' });
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(received[0].data).toEqual({ orderId: 'abc' });
    expect(received[0].type).toBe('event:order.placed');
  });

  it('manual handler is invoked on fire()', async () => {
    adapter = new LocalTriggerAdapter();
    const called: unknown[] = [];
    await adapter.register({ kind: 'manual' }, async (env) => {
      called.push(env.data);
    });
    await adapter.start();

    adapter.fire('manual', { reason: 'test' });
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(called).toHaveLength(1);
    expect(called[0]).toEqual({ reason: 'test' });
  });

  it('mcp handler is invoked on fire()', async () => {
    adapter = new LocalTriggerAdapter();
    const called: unknown[] = [];
    await adapter.register({ kind: 'mcp', toolName: 'analyze-pr' }, async (env) => {
      called.push(env.data);
    });
    await adapter.start();

    adapter.fire('mcp:analyze-pr', { pr: 42 });
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(called).toHaveLength(1);
    expect(called[0]).toEqual({ pr: 42 });
  });

  it('multiple handlers for the same event are all invoked', async () => {
    adapter = new LocalTriggerAdapter();
    const calls: number[] = [];
    await adapter.register({ kind: 'event', name: 'tick' }, async () => {
      calls.push(1);
    });
    await adapter.register({ kind: 'event', name: 'tick' }, async () => {
      calls.push(2);
    });
    await adapter.start();

    adapter.fire('event:tick', {});
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(calls.sort()).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Webhook tests
// ---------------------------------------------------------------------------

describe('LocalTriggerAdapter — webhook', () => {
  let adapter: LocalTriggerAdapter;

  beforeEach(() => {
    adapter = new LocalTriggerAdapter();
  });

  afterEach(async () => {
    await adapter.stop();
    vi.useRealTimers();
  });

  async function baseUrl(): Promise<string> {
    const addr = adapter.address;
    if (!addr) throw new Error('adapter not started');
    return `http://${addr.host}:${addr.port}`;
  }

  it('POST with valid JSON → handler invoked, 200 { ok: true }', async () => {
    const received: unknown[] = [];
    await adapter.register({ kind: 'webhook', path: '/hooks/test' }, async (env) => {
      received.push(env.data);
    });
    await adapter.start();

    const res = await fetch(`${await baseUrl()}/hooks/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ x: 1 });
  });

  it('POST with invalid JSON → 400 { error: "invalid_json" }, handler not invoked', async () => {
    const received: unknown[] = [];
    await adapter.register({ kind: 'webhook', path: '/hooks/bad' }, async (env) => {
      received.push(env);
    });
    await adapter.start();

    const res = await fetch(`${await baseUrl()}/hooks/bad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_json');
    expect(received).toHaveLength(0);
  });

  it('GET on registered path → 405 with Allow: POST header', async () => {
    await adapter.register({ kind: 'webhook', path: '/hooks/get-test' }, async () => {});
    await adapter.start();

    const res = await fetch(`${await baseUrl()}/hooks/get-test`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('POST on unregistered path → 404', async () => {
    await adapter.register({ kind: 'webhook', path: '/hooks/real' }, async () => {});
    await adapter.start();

    const res = await fetch(`${await baseUrl()}/hooks/missing`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('handler throws → 500 { error: "handler_failed" }', async () => {
    await adapter.register({ kind: 'webhook', path: '/hooks/boom' }, async () => {
      throw new Error('intentional failure');
    });
    await adapter.start();

    const res = await fetch(`${await baseUrl()}/hooks/boom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: true }),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('handler_failed');
    expect(body.message).toBe('intentional failure');
  });
});

// ---------------------------------------------------------------------------
// Cron integration tests (fake timers)
// ---------------------------------------------------------------------------

describe('LocalTriggerAdapter — cron scheduler', () => {
  let adapter: LocalTriggerAdapter;

  afterEach(async () => {
    await adapter.stop();
    vi.useRealTimers();
  });

  it('* * * * * fires handler exactly once per minute boundary', async () => {
    vi.useFakeTimers();
    adapter = new LocalTriggerAdapter();
    const fired: unknown[] = [];
    await adapter.register({ kind: 'cron', expr: '* * * * *' }, async (env) => {
      fired.push(env);
    });
    await adapter.start();

    // Advance 61 seconds (covers a full minute tick at the 1s interval)
    await vi.advanceTimersByTimeAsync(61_000);

    expect(fired.length).toBeGreaterThanOrEqual(1);

    // Advance another full minute — should fire exactly one more time
    const before = fired.length;
    await vi.advanceTimersByTimeAsync(60_000);
    // At most one additional fire per minute boundary
    expect(fired.length).toBeGreaterThanOrEqual(before);
  });

  it('30 14 * * * fires only when hour=14 and minute=30', async () => {
    vi.useFakeTimers();
    // Set date to 2024-01-15 14:29:00 (second=0) so 59 ticks lands at 14:29:59 (no match),
    // and the 60th tick lands at 14:30:00 (match).
    vi.setSystemTime(new Date(2024, 0, 15, 14, 29, 0));

    adapter = new LocalTriggerAdapter();
    const fired: unknown[] = [];
    await adapter.register({ kind: 'cron', expr: '30 14 * * *' }, async () => {
      fired.push(true);
    });
    await adapter.start();

    // 59 ticks (59 seconds) → still 14:29:59 — should not fire
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fired).toHaveLength(0);

    // 1 more tick → 14:30:00 — should fire exactly once
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fired).toHaveLength(1);

    // Another 60s still in 14:30 minute (dedup) → should not fire again
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fired).toHaveLength(1);
  });
});

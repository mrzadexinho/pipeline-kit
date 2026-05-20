/**
 * RunGuard 5-shape conformance tests — ADR IV-5 / HARD GATE B4.
 *
 * Verifies that buildFunctionConfig produces the correct Inngest primitives
 * for each of the 5 named RunGuard shapes defined in ADR IV-5.
 */
import { describe, expect, it } from 'vitest';
import type { KitFunctionConfig } from '../src/create-kit-function.js';
import { buildFunctionConfig } from '../src/create-kit-function.js';

const BASE: Pick<KitFunctionConfig, 'trigger'> = {
  trigger: { kind: 'event', name: 'app/test.event' },
};

// ─── Shape 1: unbounded parallelism (default / no RunGuard) ──────────────────

describe('Shape 1 — unbounded parallelism (no RunGuard)', () => {
  it('produces no concurrency, no singleton, no throttle config', () => {
    const cfg = buildFunctionConfig({ id: 'shape-1', ...BASE });
    expect(cfg.concurrency).toBeUndefined();
    expect(cfg.singleton).toBeUndefined();
    expect(cfg.throttle).toBeUndefined();
  });

  it('sets idempotency unconditionally (IV-6)', () => {
    const cfg = buildFunctionConfig({ id: 'shape-1', ...BASE });
    expect(cfg.idempotency).toBe('event.data.dedupKey');
  });

  it('always includes the function id', () => {
    const cfg = buildFunctionConfig({ id: 'shape-1-id', ...BASE });
    expect(cfg.id).toBe('shape-1-id');
  });
});

// ─── Shape 2: bounded parallelism ────────────────────────────────────────────

describe('Shape 2 — bounded parallelism { concurrency: { limit: N } }', () => {
  it('maps to Inngest concurrency array with the specified limit', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-2',
      ...BASE,
      runGuard: { concurrency: { limit: 5 } },
    });
    expect(cfg.concurrency).toEqual([{ limit: 5 }]);
  });

  it('does not set singleton or throttle', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-2',
      ...BASE,
      runGuard: { concurrency: { limit: 5 } },
    });
    expect(cfg.singleton).toBeUndefined();
    expect(cfg.throttle).toBeUndefined();
  });
});

// ─── Shape 3: sequential singleton (never skip) ───────────────────────────────

describe('Shape 3 — sequential singleton { concurrency: { limit: 1, overflow: "queue" } }', () => {
  it('maps to Inngest concurrency array with limit 1 and no key (queueing)', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-3',
      ...BASE,
      runGuard: { concurrency: { limit: 1, overflow: 'queue' } },
    });
    expect(cfg.concurrency).toEqual([{ limit: 1 }]);
  });

  it('does NOT use singleton primitive (queue never skips)', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-3',
      ...BASE,
      runGuard: { concurrency: { limit: 1, overflow: 'queue' } },
    });
    expect(cfg.singleton).toBeUndefined();
  });
});

// ─── Shape 4: true singleton (skip overlapping) ───────────────────────────────

describe('Shape 4 — true singleton { concurrency: { limit: 1, overflow: "reject" } }', () => {
  it('maps to Inngest singleton primitive with mode "skip" (not concurrency array)', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-4',
      ...BASE,
      runGuard: { concurrency: { limit: 1, overflow: 'reject' } },
    });
    expect(cfg.singleton).toEqual({ key: 'event.data.pipelineId', mode: 'skip' });
    expect(cfg.concurrency).toBeUndefined();
  });

  it('key is "event.data.pipelineId" for per-pipeline singleton enforcement', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-4',
      ...BASE,
      runGuard: { concurrency: { limit: 5, overflow: 'reject' } },
    });
    // limit is ignored for reject — singleton covers the semantics
    expect((cfg.singleton as { key: string }).key).toBe('event.data.pipelineId');
    expect((cfg.singleton as { mode: string }).mode).toBe('skip');
  });
});

// ─── Shape 5: event dedup window ─────────────────────────────────────────────

describe('Shape 5 — event dedup window { dedup: { period } }', () => {
  it('sets idempotency expression unconditionally', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-5',
      ...BASE,
      runGuard: { dedup: { period: '24h' } },
    });
    expect(cfg.idempotency).toBe('event.data.dedupKey');
  });

  it('sets throttle with limit 1, the specified period, and the dedup key', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-5',
      ...BASE,
      runGuard: { dedup: { period: '24h' } },
    });
    expect(cfg.throttle).toEqual({
      limit: 1,
      period: '24h',
      key: 'event.data.dedupKey',
    });
  });

  it('forwards different period values correctly', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-5b',
      ...BASE,
      runGuard: { dedup: { period: '1h' } },
    });
    expect((cfg.throttle as { period: string }).period).toBe('1h');
  });

  it('does not set concurrency or singleton for dedup-only guard', () => {
    const cfg = buildFunctionConfig({
      id: 'shape-5',
      ...BASE,
      runGuard: { dedup: { period: '24h' } },
    });
    expect(cfg.concurrency).toBeUndefined();
    expect(cfg.singleton).toBeUndefined();
  });
});

// ─── Orthogonality: concurrency + dedup can compose ──────────────────────────

describe('Composed guard: concurrency + dedup (shapes 2+5)', () => {
  it('sets both concurrency and throttle when both fields are present', () => {
    const cfg = buildFunctionConfig({
      id: 'composed',
      ...BASE,
      runGuard: { concurrency: { limit: 3 }, dedup: { period: '12h' } },
    });
    expect(cfg.concurrency).toEqual([{ limit: 3 }]);
    expect(cfg.throttle).toEqual({ limit: 1, period: '12h', key: 'event.data.dedupKey' });
    expect(cfg.idempotency).toBe('event.data.dedupKey');
  });
});

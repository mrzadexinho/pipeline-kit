import { describe, expect, it } from 'vitest';
import type {
  KitTriggerEnvelope,
  RunGuard,
  TriggerAdapter,
  TriggerConfig,
} from '../src/trigger.js';

describe('TriggerConfig', () => {
  it('covers all 5 trigger kinds (type-level + runtime)', () => {
    const configs: TriggerConfig[] = [
      { kind: 'cron', expr: '0 * * * *' },
      { kind: 'webhook', path: '/hooks/ingest' },
      { kind: 'event', name: 'user.signed_up' },
      { kind: 'manual' },
      { kind: 'mcp', toolName: 'run_pipeline' },
    ];
    const kinds = configs.map((c) => c.kind);
    expect(kinds).toContain('cron');
    expect(kinds).toContain('webhook');
    expect(kinds).toContain('event');
    expect(kinds).toContain('manual');
    expect(kinds).toContain('mcp');
  });

  it('discriminant narrows correctly at runtime', () => {
    const config: TriggerConfig = { kind: 'cron', expr: '*/5 * * * *' };
    if (config.kind === 'cron') {
      expect(config.expr).toBe('*/5 * * * *');
    }
  });
});

describe('RunGuard', () => {
  it('allows empty guard (unbounded parallelism)', () => {
    const guard: RunGuard = {};
    expect(guard.concurrency).toBeUndefined();
    expect(guard.dedup).toBeUndefined();
  });

  it('allows concurrency-only guard', () => {
    const guard: RunGuard = { concurrency: { limit: 5 } };
    expect(guard.concurrency?.limit).toBe(5);
  });

  it('allows overflow within concurrency', () => {
    const queue: RunGuard = { concurrency: { limit: 1, overflow: 'queue' } };
    const reject: RunGuard = { concurrency: { limit: 1, overflow: 'reject' } };
    expect(queue.concurrency?.overflow).toBe('queue');
    expect(reject.concurrency?.overflow).toBe('reject');
  });

  it('allows dedup-only guard', () => {
    const guard: RunGuard = { dedup: { period: '24h' } };
    expect(guard.dedup?.period).toBe('24h');
  });

  it('allows composition of concurrency + dedup (orthogonal concerns)', () => {
    const guard: RunGuard = {
      concurrency: { limit: 3, overflow: 'queue' },
      dedup: { period: '1h' },
    };
    expect(guard.concurrency?.limit).toBe(3);
    expect(guard.dedup?.period).toBe('1h');
  });
});

describe('KitTriggerEnvelope', () => {
  it('generic parameter types the data field', () => {
    const envelope: KitTriggerEnvelope<{ userId: string }> = {
      id: 'pk_tev_01HZ',
      type: 'user.signed_up',
      source: 'pk://pipeline/user-onboard',
      time: new Date().toISOString(),
      data: { userId: 'u_123' },
    };
    expect(envelope.data.userId).toBe('u_123');
  });

  it('dedupKey is optional', () => {
    const withDedup: KitTriggerEnvelope<null> = {
      id: 'pk_tev_01HZ',
      type: 'manual',
      source: 'pk://manual',
      time: new Date().toISOString(),
      data: null,
      dedupKey: 'unique-run-abc',
    };
    const withoutDedup: KitTriggerEnvelope<null> = {
      id: 'pk_tev_01HZ',
      type: 'manual',
      source: 'pk://manual',
      time: new Date().toISOString(),
      data: null,
    };
    expect(withDedup.dedupKey).toBe('unique-run-abc');
    expect(withoutDedup.dedupKey).toBeUndefined();
  });

  it('TriggerAdapter interface is structurally satisfiable', () => {
    const adapter: TriggerAdapter = {
      async register(_config, _handler) {
        // no-op stub satisfies the interface
      },
    };
    expect(typeof adapter.register).toBe('function');
  });
});

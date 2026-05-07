import { describe, expect, it } from 'vitest';
import { generateIdempotencyKey, scopedIdempotencyKey } from '../../src/composer/idempotency.js';

describe('generateIdempotencyKey', () => {
  it('returns a pk_evt_<ulid> formatted key', () => {
    const k = generateIdempotencyKey();
    expect(k).toMatch(/^pk_evt_/);
    expect(k.length).toBeGreaterThan('pk_evt_'.length);
  });

  it('produces unique keys across 100 calls', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(generateIdempotencyKey());
    }
    expect(set.size).toBe(100);
  });
});

describe('scopedIdempotencyKey', () => {
  it('joins runId, serveAdapterId, atomId with colons', () => {
    const k = scopedIdempotencyKey({
      runId: 'pk_run_R',
      serveAdapterId: 'pk_serve_S',
      atomId: 'pk_atom_A',
    });
    expect(k).toBe('pk_run_R:pk_serve_S:pk_atom_A');
  });

  it('different scopes yield different keys', () => {
    const a = scopedIdempotencyKey({
      runId: 'r1',
      serveAdapterId: 's1',
      atomId: 'a1',
    });
    const b = scopedIdempotencyKey({
      runId: 'r1',
      serveAdapterId: 's1',
      atomId: 'a2',
    });
    expect(a).not.toBe(b);
  });
});

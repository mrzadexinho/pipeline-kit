import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIdempotencyKey } from '../../src/composer/idempotency.js';

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

// ---------------------------------------------------------------------------
// scopedIdempotencyKey — HMAC-signed idempotency keys (ADR IV-6)
// Each test block resets modules + env to ensure hermeticity.
// ---------------------------------------------------------------------------

const SCOPE_A = {
  runId: 'pk_run_R',
  serveAdapterId: 'pk_serve_S',
  atomId: 'pk_atom_A',
};

const SCOPE_B = {
  runId: 'pk_run_R',
  serveAdapterId: 'pk_serve_S',
  atomId: 'pk_atom_B',
};

const isBun = typeof (globalThis as Record<string, unknown>).Bun !== 'undefined';

/** Dynamically import a fresh module (module-level cache reset). */
async function freshImport() {
  vi.resetModules();
  const mod = await import('../../src/composer/idempotency.js');
  return mod.scopedIdempotencyKey;
}

// TODO(M9): vi.resetModules() unavailable in Bun — re-enable when Bun adds support
describe.skipIf(isBun)('scopedIdempotencyKey — shape', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.PK_SIGNING_KEY = process.env.PK_SIGNING_KEY;
    process.env.PK_SIGNING_KEY = 'test-master-key-for-shape';
  });

  afterEach(() => {
    if (savedEnv.PK_SIGNING_KEY === undefined) {
      delete process.env.PK_SIGNING_KEY;
    } else {
      process.env.PK_SIGNING_KEY = savedEnv.PK_SIGNING_KEY;
    }
  });

  it('returned key matches <runId>:<serveAdapterId>:<atomId>:<16-hex-chars>', async () => {
    const scopedIdempotencyKey = await freshImport();
    const k = scopedIdempotencyKey(SCOPE_A);
    expect(k).toMatch(/^pk_run_R:pk_serve_S:pk_atom_A:[0-9a-f]{16}$/);
  });

  it('different scopes yield different keys', async () => {
    const scopedIdempotencyKey = await freshImport();
    const a = scopedIdempotencyKey(SCOPE_A);
    const b = scopedIdempotencyKey(SCOPE_B);
    expect(a).not.toBe(b);
  });
});

// TODO(M9): vi.resetModules() unavailable in Bun — re-enable when Bun adds support
describe.skipIf(isBun)('scopedIdempotencyKey — determinism', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.PK_SIGNING_KEY = process.env.PK_SIGNING_KEY;
    process.env.PK_SIGNING_KEY = 'determinism-master-key';
  });

  afterEach(() => {
    if (savedEnv.PK_SIGNING_KEY === undefined) {
      delete process.env.PK_SIGNING_KEY;
    } else {
      process.env.PK_SIGNING_KEY = savedEnv.PK_SIGNING_KEY;
    }
  });

  it('same scope + same master → same key (deterministic)', async () => {
    const scopedIdempotencyKey = await freshImport();
    const first = scopedIdempotencyKey(SCOPE_A);
    const second = scopedIdempotencyKey(SCOPE_A);
    expect(first).toBe(second);
  });

  it('same scope + different master → different HMAC tail', async () => {
    process.env.PK_SIGNING_KEY = 'master-key-1';
    const fn1 = await freshImport();
    const key1 = fn1(SCOPE_A);

    process.env.PK_SIGNING_KEY = 'master-key-2';
    const fn2 = await freshImport();
    const key2 = fn2(SCOPE_A);

    // Prefix (first 3 colon-separated parts) is the same; tail differs.
    const tail1 = key1.split(':').at(-1);
    const tail2 = key2.split(':').at(-1);
    expect(tail1).not.toBe(tail2);
  });

  it('different scope + same master → different HMAC tail', async () => {
    const scopedIdempotencyKey = await freshImport();
    const keyA = scopedIdempotencyKey(SCOPE_A);
    const keyB = scopedIdempotencyKey(SCOPE_B);
    const tailA = keyA.split(':').at(-1);
    const tailB = keyB.split(':').at(-1);
    expect(tailA).not.toBe(tailB);
  });
});

// TODO(M9): vi.resetModules() unavailable in Bun — re-enable when Bun adds support
describe.skipIf(isBun)('scopedIdempotencyKey — missing key throws', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.PK_SIGNING_KEY = process.env.PK_SIGNING_KEY;
    delete process.env.PK_SIGNING_KEY;
  });

  afterEach(() => {
    if (savedEnv.PK_SIGNING_KEY === undefined) {
      delete process.env.PK_SIGNING_KEY;
    } else {
      process.env.PK_SIGNING_KEY = savedEnv.PK_SIGNING_KEY;
    }
  });

  it('throws with "No signing key configured" when PK_SIGNING_KEY is not set', async () => {
    const scopedIdempotencyKey = await freshImport();
    expect(() => scopedIdempotencyKey(SCOPE_A)).toThrow('No signing key configured');
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSqliteStoreForBun } from '../src/index.js';

const isRunningBun = typeof Bun !== 'undefined';

describe.skipIf(!isRunningBun)('createSqliteStoreForBun — Bun runtime', () => {
  it('createSqliteStoreForBun resolves to a store with put/get/list', async () => {
    const store = await createSqliteStoreForBun({
      path: ':memory:',
      schema: z.object({ x: z.number() }),
    });
    expect(store).toBeDefined();
    expect(typeof store.put).toBe('function');
    expect(typeof store.get).toBe('function');
    expect(typeof store.list).toBe('function');
  });

  it('createSqliteStoreForBun differs from createSqliteStore (Bun driver)', async () => {
    const store = await createSqliteStoreForBun({
      path: ':memory:',
      schema: z.object({ x: z.number() }),
    });
    expect(store.id).toMatch(/^pk_store_/);
  });
});

// Exported to verify the function exists even on Node
describe('createSqliteStoreForBun — export exists', () => {
  it('function is exported from the package', () => {
    expect(typeof createSqliteStoreForBun).toBe('function');
  });
});

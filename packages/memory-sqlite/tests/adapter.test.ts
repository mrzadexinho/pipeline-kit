import * as fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteMemoryAdapter } from '../src/index.js';

describe('SqliteMemoryAdapter — basic contract (:memory:)', () => {
  let adapter: ReturnType<typeof createSqliteMemoryAdapter>;

  afterEach(async () => {
    await adapter.close();
  });

  it('read returns ok(null) for absent key', async () => {
    adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    const result = await adapter.read('missing');
    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it('write then read returns ok(value)', async () => {
    adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.write('k1', 'hello');
    const result = await adapter.read('k1');
    expect(result.error).toBeNull();
    expect(result.data).toBe('hello');
  });

  it('LWW: write(k,V1); write(k,V2); read(k) === ok(V2)', async () => {
    adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.write('k', 'V1');
    await adapter.write('k', 'V2');
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('V2');
  });

  it('write(k,"") then read(k) returns ok("") — empty distinct from absent', async () => {
    adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.write('k', '');
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('');
  });

  it('write returns ok(undefined)', async () => {
    adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    const result = await adapter.write('k', 'v');
    expect(result.error).toBeNull();
    expect(result.data).toBeUndefined();
  });
});

describe('SqliteMemoryAdapter — Listable', () => {
  it('list returns sorted keys for namespace', async () => {
    const adapter = createSqliteMemoryAdapter({
      dbPath: ':memory:',
      namespace: 'ns1',
      walMode: false,
    });
    await adapter.write('b', 'b-val');
    await adapter.write('a', 'a-val');
    await adapter.write('c', 'c-val');
    const result = await adapter.list('ns1');
    expect(result.error).toBeNull();
    expect(result.data).toEqual(['a', 'b', 'c']);
    await adapter.close();
  });

  it('list returns ok([]) for absent namespace', async () => {
    const adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    const result = await adapter.list('no-such-namespace');
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    await adapter.close();
  });
});

describe('SqliteMemoryAdapter — Disposable', () => {
  it('after close(), read returns err(memory_unavailable)', async () => {
    const adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.close();
    const result = await adapter.read('k');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('memory_unavailable');
  });

  it('after close(), write returns err(memory_unavailable)', async () => {
    const adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.close();
    const result = await adapter.write('k', 'v');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('memory_unavailable');
  });

  it('after close(), list returns err(memory_unavailable)', async () => {
    const adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.close();
    const result = await adapter.list('ns');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('memory_unavailable');
  });

  it('double close() is a no-op', async () => {
    const adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
    await adapter.close();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

describe('SqliteMemoryAdapter — property tests', () => {
  it('write(k, v); read(k) === v for any valid key and UTF-8 value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z0-9][a-z0-9:_-]*$/), fc.string(), async (k, v) => {
        const adapter = createSqliteMemoryAdapter({ dbPath: ':memory:', walMode: false });
        try {
          await adapter.write(k, v);
          const result = await adapter.read(k);
          expect(result.error).toBeNull();
          expect(result.data).toBe(v);
        } finally {
          await adapter.close();
        }
      }),
    );
  });
});

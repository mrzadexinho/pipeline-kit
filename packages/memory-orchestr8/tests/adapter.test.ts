import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { OrchestrBackend, OrchestrEntry } from '../src/index.js';
import { createOrchestr8MemoryAdapter } from '../src/index.js';

/** Creates a minimal in-memory backend stub (NOT orchestr8-mcp; just a Map). */
function createStubBackend(): OrchestrBackend {
  const store = new Map<string, OrchestrEntry>();

  return {
    async store(entry) {
      // Faithfully mirrors orchestr8 silent-first-write-wins:
      // if key already exists in this namespace, this call is a no-op.
      const existing = [...store.values()].find(
        (e) => e.key === entry.key && e.namespace === entry.namespace,
      );
      if (existing === undefined) {
        store.set(entry.id, entry);
      }
      // silent no-op when key already present — orchestr8 behaviour per Cat V α.2
    },
    async retrieve(key, namespace = 'default') {
      return [...store.values()].find((e) => e.key === key && e.namespace === namespace);
    },
    async query({ namespace, keyPrefix }) {
      const ns = namespace ?? '';
      const prefix = keyPrefix ?? '';
      const entries = [...store.values()]
        .filter((e) => e.namespace === ns && e.key.startsWith(prefix))
        .map((e) => ({ entry: { key: e.key } }));
      return entries;
    },
    async delete(id) {
      store.delete(id);
    },
    async close() {
      store.clear();
    },
  };
}

describe('Orchestr8MemoryAdapter — basic contract', () => {
  it('read returns ok(null) for absent key', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    const result = await adapter.read('missing');
    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it('write then read returns ok(value)', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.write('k1', 'hello');
    const result = await adapter.read('k1');
    expect(result.error).toBeNull();
    expect(result.data).toBe('hello');
  });

  it('LWW: write(k,V1); write(k,V2); read(k) === ok(V2)', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.write('k', 'V1');
    await adapter.write('k', 'V2');
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('V2');
  });

  it('write(k,"") then read(k) returns ok("") — empty distinct from absent', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.write('k', '');
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('');
  });

  it('write returns ok(undefined)', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    const result = await adapter.write('k', 'v');
    expect(result.error).toBeNull();
    expect(result.data).toBeUndefined();
  });
});

describe('Orchestr8MemoryAdapter — Listable', () => {
  it('list returns alphabetically sorted keys for namespace', async () => {
    const adapter = createOrchestr8MemoryAdapter({
      backend: createStubBackend(),
      namespace: 'ns1',
    });
    await adapter.write('b', 'b-val');
    await adapter.write('a', 'a-val');
    await adapter.write('c', 'c-val');
    const result = await adapter.list('ns1');
    expect(result.error).toBeNull();
    expect(result.data).toEqual(['a', 'b', 'c']);
  });

  it('list returns ok([]) for absent namespace', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    const result = await adapter.list('no-such-namespace');
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});

describe('Orchestr8MemoryAdapter — Disposable', () => {
  it('after close(), read returns err(memory_unavailable)', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.close();
    const result = await adapter.read('k');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('memory_unavailable');
  });

  it('after close(), write returns err(memory_unavailable)', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.close();
    const result = await adapter.write('k', 'v');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('memory_unavailable');
  });

  it('after close(), list returns err(memory_unavailable)', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.close();
    const result = await adapter.list('ns');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('memory_unavailable');
  });

  it('double close() is a no-op', async () => {
    const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
    await adapter.close();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

describe('Orchestr8MemoryAdapter — property tests', () => {
  it('write(k, v); read(k) === v for any valid key and UTF-8 value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z0-9][a-z0-9:_-]*$/), fc.string(), async (k, v) => {
        const adapter = createOrchestr8MemoryAdapter({ backend: createStubBackend() });
        await adapter.write(k, v);
        const result = await adapter.read(k);
        expect(result.error).toBeNull();
        expect(result.data).toBe(v);
        await adapter.close();
      }),
    );
  });
});

describe('Orchestr8MemoryAdapter — namespace isolation', () => {
  it('keys in different namespaces do not collide', async () => {
    const backend = createStubBackend();
    const ns1 = createOrchestr8MemoryAdapter({ backend, namespace: 'ns1' });
    const ns2 = createOrchestr8MemoryAdapter({ backend, namespace: 'ns2' });
    await ns1.write('key', 'from-ns1');
    const result = await ns2.read('key');
    expect(result.data).toBeNull();
  });
});

describe('Orchestr8MemoryAdapter — backend error propagation', () => {
  it('read propagates backend error as err(unknown)', async () => {
    const backend = createStubBackend();
    vi.spyOn(backend, 'retrieve').mockRejectedValue(new Error('db failure'));
    const adapter = createOrchestr8MemoryAdapter({ backend });
    const result = await adapter.read('k');
    expect(result.error?.code).toBe('unknown');
    expect(result.error?.message).toContain('db failure');
  });

  it('write propagates backend error as err(unknown)', async () => {
    const backend = createStubBackend();
    vi.spyOn(backend, 'retrieve').mockRejectedValue(new Error('db failure'));
    const adapter = createOrchestr8MemoryAdapter({ backend });
    const result = await adapter.write('k', 'v');
    expect(result.error?.code).toBe('unknown');
  });
});

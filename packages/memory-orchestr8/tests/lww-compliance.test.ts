/**
 * Explicit LWW-wrap compliance test (Acceptance Criterion #4).
 *
 * Proves that the adapter's write() path fires delete()+store() when a
 * key already exists — not just store() — even though orchestr8's store()
 * is silent-first-write-wins.
 *
 * Strategy: mock `backend.store` to simulate orchestr8 silent-FWW behaviour
 * (only the FIRST store call inserts; subsequent calls for the same key are
 * no-ops). Without the adapter's LWW wrap the second write would silently
 * fail to update and read() would still return V1. The test asserts V2,
 * proving the delete+re-store path fired.
 */

import { describe, expect, it, vi } from 'vitest';
import type { OrchestrBackend, OrchestrEntry } from '../src/index.js';
import { createOrchestr8MemoryAdapter } from '../src/index.js';

/**
 * Backend stub where store() faithfully mimics orchestr8 silent-FWW:
 * only the first store call for a (key, namespace) pair succeeds;
 * subsequent calls are silent no-ops.
 */
function createSilentFwwBackend(): OrchestrBackend {
  const entries = new Map<string, OrchestrEntry>(); // id → entry
  const keyIndex = new Map<string, string>(); // `${ns}:${key}` → id

  return {
    async store(entry) {
      const indexKey = `${entry.namespace}:${entry.key}`;
      if (keyIndex.has(indexKey)) {
        // Silent no-op — this is the orchestr8 first-write-wins behaviour
        return;
      }
      entries.set(entry.id, entry);
      keyIndex.set(indexKey, entry.id);
    },
    async retrieve(key, namespace = 'default') {
      const indexKey = `${namespace}:${key}`;
      const id = keyIndex.get(indexKey);
      if (id === undefined) return undefined;
      return entries.get(id);
    },
    async query({ namespace, keyPrefix }) {
      const ns = namespace ?? '';
      const prefix = keyPrefix ?? '';
      return [...entries.values()]
        .filter((e) => e.namespace === ns && e.key.startsWith(prefix))
        .map((e) => ({ entry: { key: e.key } }));
    },
    async delete(id) {
      const entry = entries.get(id);
      if (entry !== undefined) {
        const indexKey = `${entry.namespace}:${entry.key}`;
        keyIndex.delete(indexKey);
        entries.delete(id);
      }
    },
    async close() {
      entries.clear();
      keyIndex.clear();
    },
  };
}

describe('LWW-wrap compliance — delete+re-store path', () => {
  it('write(k, V1); write(k, V2); read(k) === V2 — proves delete+re-store fires', async () => {
    const backend = createSilentFwwBackend();
    const deleteSpy = vi.spyOn(backend, 'delete');
    const storeSpy = vi.spyOn(backend, 'store');

    const adapter = createOrchestr8MemoryAdapter({ backend });

    // First write: key absent → store() called once, delete() not called
    await adapter.write('k', 'V1');
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(storeSpy).toHaveBeenCalledTimes(1);

    const afterV1 = await adapter.read('k');
    expect(afterV1.data).toBe('V1');

    // Second write: key present → delete(existing.id) then store(new)
    await adapter.write('k', 'V2');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(storeSpy).toHaveBeenCalledTimes(2);

    // Final read: must return V2, not V1
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('V2');
  });

  it('without the LWW wrap, a silent-FWW backend would return V1 — baseline proof', async () => {
    // This test demonstrates WHAT WOULD HAPPEN without the wrap.
    // It calls the backend directly (bypassing the adapter's LWW logic)
    // to prove that the backend alone cannot provide LWW.
    const backend = createSilentFwwBackend();
    const now = Date.now();

    const entryV1: OrchestrEntry = {
      id: `id_v1_${now}`,
      key: 'k',
      content: 'V1',
      type: 'working',
      namespace: 'default',
      tags: [],
      metadata: {},
      version: 1,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const entryV2: OrchestrEntry = {
      id: `id_v2_${now + 1}`,
      key: 'k',
      content: 'V2',
      type: 'working',
      namespace: 'default',
      tags: [],
      metadata: {},
      version: 1,
      accessCount: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    };

    // Direct backend calls — no LWW wrap
    await backend.store(entryV1);
    await backend.store(entryV2); // silent no-op per FWW behaviour

    const retrieved = await backend.retrieve('k', 'default');
    // Backend alone returns V1 (silent FWW); proves wrap is load-bearing
    expect(retrieved?.content).toBe('V1');
  });

  it('multiple sequential overwrites all resolve to the last value', async () => {
    const backend = createSilentFwwBackend();
    const adapter = createOrchestr8MemoryAdapter({ backend });

    for (let i = 1; i <= 5; i++) {
      await adapter.write('k', `V${i}`);
    }
    const result = await adapter.read('k');
    expect(result.error).toBeNull();
    expect(result.data).toBe('V5');
  });
});

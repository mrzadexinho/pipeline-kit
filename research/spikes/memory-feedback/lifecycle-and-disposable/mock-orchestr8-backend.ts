// Cat V spike #2 — small wrap of orchestr8-mcp SQLiteBackend.
// Centralised so cells α / β / γ all share the SAME boundary; only the
// outer adapter shape differs. Backend exposes initialize() + close(),
// which is the lifecycle behaviour the spike probes.
//
// LOC budget: ≤30. Strict TS, no `any`, ESM.

import { SQLiteBackend, createMemoryEntry } from 'orchestr8-mcp/dist/memory/index.js';

export const SPIKE_NAMESPACE = 'pk-spike-cat-v-lifecycle';

export interface RawBackend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

export async function createRawBackend(): Promise<RawBackend> {
  const backend = new SQLiteBackend({ databasePath: ':memory:' });
  await backend.initialize();
  return {
    async read(key) {
      const entry = await backend.retrieve(key, SPIKE_NAMESPACE);
      return entry === undefined ? null : entry.content;
    },
    async write(key, value) {
      const entry = createMemoryEntry({
        key,
        content: value,
        namespace: SPIKE_NAMESPACE,
        type: 'working',
      });
      await backend.store(entry);
    },
    async close() {
      await backend.close();
    },
  };
}

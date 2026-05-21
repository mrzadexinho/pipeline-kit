# @idriszade/memory-orchestr8

`orchestr8-mcp` `SQLiteBackend`-backed `MemoryAdapter` for pipeline-kit. Implements `Disposable` and `Listable`. Includes a mandatory LWW wrap around orchestr8's silent-first-write-wins `store()`.

Part of the ADR V-6 memory adapter trio alongside `@idriszade/memory-map` and `@idriszade/memory-sqlite`.

## Install

```bash
pnpm add @idriszade/memory-orchestr8 orchestr8-mcp
```

## Usage

```ts
import { SQLiteBackend } from 'orchestr8-mcp/dist/memory/index.js';
import { createOrchestr8MemoryAdapter } from '@idriszade/memory-orchestr8';

// 1. Initialise the backend first
const backend = new SQLiteBackend({ databasePath: ':memory:' });
await backend.initialize();

// 2. Create the adapter
const adapter = createOrchestr8MemoryAdapter({ backend, namespace: 'my-pipeline' });

// 3. Use
await adapter.write('job-123', JSON.stringify({ status: 'done' }));
const result = await adapter.read('job-123');

// 4. List keys
const keys = await adapter.list('my-pipeline');

// 5. Dispose
await adapter.close();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backend` | `OrchestrBackend` | — | Already-initialised `SQLiteBackend` instance |
| `namespace` | `string` | `'default'` | Namespace passed to all backend operations |

## LWW Wrap

orchestr8-mcp's `store()` is **silent-first-write-wins**: if a key already exists in the namespace, a second `store()` call for the same key is a no-op. This adapter wraps `write()` to enforce Last-Writer-Wins:

```
write(key, newValue):
  1. retrieve(key, namespace)  → entry present? → delete(entry.id)
  2. store(newEntry with newValue)
```

This wrap is **load-bearing** — removing it breaks LWW contract (ADR V-4).

## Contract

- Implements `MemoryAdapter`, `Disposable`, and `Listable` from `@idriszade/memory`.
- After `close()`, all operations return `err({ code: 'memory_unavailable' })`.
- `list(namespace)` returns alphabetically sorted, de-duplicated keys.
- Suitable for <10k KV entries per ADR V-6.

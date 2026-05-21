# @idriszade/memory-sqlite

`better-sqlite3`-backed `MemoryAdapter` for pipeline-kit. Persistent, synchronous-native, WAL-enabled by default. Implements `Disposable` and `Listable`.

Part of the ADR V-6 memory adapter trio alongside `@idriszade/memory-map` and `@idriszade/memory-orchestr8`.

## Install

```bash
pnpm add @idriszade/memory-sqlite
```

## Usage

```ts
import { createSqliteMemoryAdapter } from '@idriszade/memory-sqlite';
import { isDisposable, isListable } from '@idriszade/memory';

const adapter = createSqliteMemoryAdapter({
  dbPath: './pipeline-state.sqlite',
  namespace: 'my-pipeline',
  walMode: true, // default
});

// Write + read
await adapter.write('job-123', JSON.stringify({ status: 'done' }));
const result = await adapter.read('job-123');

// List all keys in a namespace
if (isListable(adapter)) {
  const keys = await adapter.list('my-pipeline');
}

// Dispose
if (isDisposable(adapter)) {
  await adapter.close();
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | — | `':memory:'` or a file path |
| `namespace` | `string` | `undefined` | Stored in the `namespace` column; used to scope reads/writes and list queries |
| `walMode` | `boolean` | `true` | Enable WAL journal mode (`PRAGMA journal_mode=WAL`) |

## Schema

```sql
CREATE TABLE IF NOT EXISTS memory (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  namespace  TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
```

## Contract

- Implements `MemoryAdapter`, `Disposable`, and `Listable` from `@idriszade/memory`.
- LWW via `INSERT OR REPLACE` — native SQLite atomic upsert.
- After `close()`, all operations return `err({ code: 'memory_unavailable' })`.
- WAL mode: 100 sequential writes complete in <50ms on modern hardware.

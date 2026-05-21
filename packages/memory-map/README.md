# @idriszade/memory-map

In-memory `Map<string,string>`-backed `MemoryAdapter` reference fixture for pipeline-kit.

Part of the ADR V-6 memory adapter trio alongside `@idriszade/memory-orchestr8` and `@idriszade/memory-sqlite`.

## Purpose

This adapter is the **canonical test fixture** — zero production dependencies, no native bindings, no lifecycle management. Use it in tests and local development. For production use, prefer `@idriszade/memory-sqlite` (persistent) or `@idriszade/memory-orchestr8` (orchestr8-mcp integration).

## Install

```bash
pnpm add @idriszade/memory-map
```

## Usage

```ts
import { createMapMemoryAdapter } from '@idriszade/memory-map';

const adapter = createMapMemoryAdapter({ namespace: 'my-pipeline' });

await adapter.write('job-123', JSON.stringify({ status: 'done' }));
const result = await adapter.read('job-123');
if (result.error === null) {
  console.log(result.data); // '{"status":"done"}'
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `namespace` | `string` | `undefined` | When set, keys are stored as `${namespace}::${key}` |

## Contract

- Implements `MemoryAdapter` from `@idriszade/memory`.
- LWW (last-writer-wins): `write(k, V2)` after `write(k, V1)` makes `read(k)` return `V2`.
- `read` on absent key returns `ok(null)`.
- Empty string is a valid value: `write(k, '')` then `read(k)` returns `ok('')`.
- Does **not** implement `Disposable` or `Listable` (minimal fixture per ADR V-6).

# @idriszade/store-sqlite

Store adapter for persisting pipeline atoms to SQLite via Drizzle ORM. Uses `better-sqlite3` on Node; a `createSqliteStoreForBun` factory is provided for Bun runtimes (`bun:sqlite`).

## Install

```bash
pnpm add @idriszade/store-sqlite
```

`better-sqlite3` and `drizzle-orm` are bundled as direct dependencies.

## Usage

```typescript
import { createSqliteStore } from '@idriszade/store-sqlite';
import { z } from 'zod';

const store = createSqliteStore({
  path: './data/atoms.db',
  schema: z.object({ id: z.string(), payload: z.unknown() }),
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).

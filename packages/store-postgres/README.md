# @pipeline-kit/store-postgres

Store adapter for persisting pipeline atoms to PostgreSQL via Drizzle ORM. Auto-derives Zod schemas via `drizzle-orm/zod`; opens a transaction per `put` for idempotency-key checks against the cache table.

## Install

```bash
pnpm add @pipeline-kit/store-postgres
```

`drizzle-orm` and `postgres` are bundled as direct dependencies.

## Usage

```typescript
import { createPostgresStore } from '@pipeline-kit/store-postgres';
import { z } from 'zod';

const store = createPostgresStore({
  connectionString: process.env.PG_CONNECTION!,
  schema: z.object({ id: z.string(), payload: z.unknown() }),
});
```

Migrations: ships `migrations/0001_init.sql` (atom + idempotency-cache tables). Apply via `drizzle-kit migrate`; never `push` in prod.

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).

## Test coverage note

M0.5 unit tests use a proxy-based Drizzle mock (pg-mem is incompatible with drizzle-orm 0.45 + postgres.js driver). SQL correctness and migration apply are validated in Task 19 via `@testcontainers/postgresql` smoke tests (`migrations.smoke.test.ts`, `[skip-ci]` tagged for slow startup). M1 Trades Outbound provides production Postgres exercise.

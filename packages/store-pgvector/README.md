# @idriszade/store-pgvector

Store adapter for vector similarity search via pgvector and Drizzle ORM. Ships a `pgvectorColumn(dimension)` Drizzle custom-type helper and supports `cosine`, `l2`, and `inner_product` distances with `hnsw` or `ivfflat` indexes.

## Install

```bash
pnpm add @idriszade/store-pgvector
```

Postgres server-side requirement: `CREATE EXTENSION IF NOT EXISTS vector;`

## Usage

```typescript
import { createPgvectorStore } from '@idriszade/store-pgvector';
import { z } from 'zod';

const store = createPgvectorStore({
  connectionString: process.env.PG_CONNECTION!,
  dimension: 1536,
  distance: 'cosine',
  indexType: 'hnsw',
  schema: z.object({ text: z.string() }),
});

// store.put(atomWithEmbedding, ctx);
// store.search(queryEmbedding, k, filters, ctx);
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).

import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { pgvectorColumn } from './custom-type.js';

/**
 * Returns the canonical embedding table schema with a custom table name and dimension.
 * Useful for users who want to host embeddings in a differently-named table or
 * with a different vector dimension.
 */
export function defineEmbeddingTable(name: string, dim: number) {
  return pgTable(name, {
    id: text('id').primaryKey(),
    object: text('object').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata'),
    data: jsonb('data').notNull(),
    source_id: text('source_id'),
    stage_id: text('stage_id'),
    run_id: text('run_id'),
    embedding: pgvectorColumn('embedding', { dim }),
  });
}

/** Default embeddings table with dimension 1536 (OpenAI text-embedding-3-small / ada-002). */
export const embeddingTable = defineEmbeddingTable('pipeline_embeddings', 1536);

export type EmbeddingTable = ReturnType<typeof defineEmbeddingTable>;
export type EmbeddingRow = EmbeddingTable['$inferSelect'];

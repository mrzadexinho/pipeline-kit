import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export type AtomsTable = ReturnType<typeof defineAtomTable>;

export const atomsTable = defineAtomTable('pipeline_atoms');

export const idempotencyTable = sqliteTable('pipeline_idempotency_cache', {
  key: text('key').primaryKey(),
  atom_id: text('atom_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type IdempotencyRow = typeof idempotencyTable.$inferSelect;

/**
 * Returns the canonical atom table schema with a custom table name.
 * Useful for users who want to introspect the schema or host atoms in
 * a differently-named table.
 */
export function defineAtomTable(name: string) {
  return sqliteTable(name, {
    id: text('id').primaryKey(),
    object: text('object').notNull(),
    created_at: text('created_at').notNull(), // ISO-8601 string; list() sorts lexicographically — valid only for well-formed ISO dates
    metadata: text('metadata', { mode: 'json' }),
    data: text('data', { mode: 'json' }).notNull(),
    source_id: text('source_id'),
    stage_id: text('stage_id'),
    run_id: text('run_id'),
  });
}

export type AtomRow = ReturnType<typeof defineAtomTable>['$inferSelect'];

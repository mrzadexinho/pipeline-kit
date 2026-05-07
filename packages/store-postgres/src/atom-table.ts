import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export type AtomsTable = ReturnType<typeof defineAtomTable>;

export const atomsTable = defineAtomTable('pipeline_atoms');

export const idempotencyTable = pgTable('pipeline_idempotency_cache', {
  key: text('key').primaryKey(),
  atom_id: text('atom_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

export type IdempotencyRow = typeof idempotencyTable.$inferSelect;

/**
 * Returns the canonical atom table schema with a custom table name.
 * Useful for users who want to introspect the schema or host atoms in
 * a differently-named table.
 */
export function defineAtomTable(name: string) {
  return pgTable(name, {
    id: text('id').primaryKey(),
    object: text('object').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata'),
    data: jsonb('data').notNull(),
    source_id: text('source_id'),
    stage_id: text('stage_id'),
    run_id: text('run_id'),
  });
}

export type AtomRow = ReturnType<typeof defineAtomTable>['$inferSelect'];

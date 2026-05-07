import { eq, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { idempotencyTable } from './atom-table.js';

export interface IdempotencyCacheHit {
  found: true;
  atomId: string;
}

export interface IdempotencyCacheMiss {
  found: false;
}

export type IdempotencyCheckResult = IdempotencyCacheHit | IdempotencyCacheMiss;

/**
 * Checks the idempotency cache for a given key.
 * Returns the cached atom_id on hit, or a miss indicator.
 */
export async function checkIdempotencyCache(
  db: PostgresJsDatabase,
  key: string,
): Promise<IdempotencyCheckResult> {
  const rows = await db
    .select()
    .from(idempotencyTable)
    .where(eq(idempotencyTable.key, key))
    .limit(1);

  const row = rows[0];
  if (row !== undefined) {
    return { found: true, atomId: row.atom_id };
  }
  return { found: false };
}

/**
 * Writes an idempotency cache entry after a successful put.
 * No-ops if insertion fails (e.g., duplicate key on race).
 */
export async function writeIdempotencyCache(
  db: PostgresJsDatabase,
  key: string,
  atomId: string,
): Promise<void> {
  await db
    .insert(idempotencyTable)
    .values({
      key,
      atom_id: atomId,
      created_at: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Purges idempotency cache entries older than ttlMs milliseconds.
 * Call this periodically to avoid unbounded cache growth.
 */
export async function purgeExpiredIdempotencyEntries(
  db: PostgresJsDatabase,
  ttlMs: number,
): Promise<void> {
  const cutoff = new Date(Date.now() - ttlMs);
  await db.delete(idempotencyTable).where(lt(idempotencyTable.created_at, cutoff));
}

import type { Disposable, Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { Listable, MemoryAdapter, MemoryError } from '@idriszade/memory';
import Database from 'better-sqlite3';

export interface SqliteMemoryAdapterOptions {
  /** ':memory:' or a file path for persistence. */
  dbPath: string;
  /** Construction-time namespace. Stored in the `namespace` column. */
  namespace?: string;
  /** Enable WAL journal mode (default: true). */
  walMode?: boolean;
}

interface MemoryRow {
  key: string;
  value: string;
  namespace: string | null;
  created_at: number | null;
  updated_at: number | null;
}

export class SqliteMemoryAdapter implements MemoryAdapter, Disposable, Listable {
  readonly #db: Database.Database;
  readonly #namespace: string | null;
  #closed = false;

  constructor(opts: SqliteMemoryAdapterOptions) {
    this.#db = new Database(opts.dbPath);
    this.#namespace = opts.namespace ?? null;
    const walMode = opts.walMode ?? true;

    if (walMode) {
      this.#db.pragma('journal_mode=WAL');
    }

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        key        TEXT    PRIMARY KEY,
        value      TEXT    NOT NULL,
        namespace  TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);
  }

  #unavailableErr(): Result<never, MemoryError> {
    return err({
      type: 'memory_error',
      code: 'memory_unavailable',
      message: 'SQLite database is closed',
    } satisfies MemoryError);
  }

  async read(key: string): Promise<Result<string | null, MemoryError>> {
    if (this.#closed) return this.#unavailableErr();
    try {
      const row = this.#db
        .prepare<[string, string | null], MemoryRow>(
          'SELECT key, value, namespace, created_at, updated_at FROM memory WHERE key = ? AND (namespace IS ? OR namespace IS NULL)',
        )
        .get(key, this.#namespace) as MemoryRow | undefined;
      return ok(row !== undefined ? row.value : null);
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }

  async write(key: string, value: string): Promise<Result<void, MemoryError>> {
    if (this.#closed) return this.#unavailableErr();
    try {
      const now = Date.now();
      this.#db
        .prepare<[string, string, string | null, number, number]>(
          'INSERT OR REPLACE INTO memory (key, value, namespace, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(key, value, this.#namespace, now, now);
      return ok(undefined);
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }

  async list(namespace: string): Promise<Result<string[], MemoryError>> {
    if (this.#closed) return this.#unavailableErr();
    try {
      const rows = this.#db
        .prepare<[string], Pick<MemoryRow, 'key'>>(
          'SELECT key FROM memory WHERE namespace = ? ORDER BY key ASC',
        )
        .all(namespace) as Array<Pick<MemoryRow, 'key'>>;
      return ok(rows.map((r) => r.key));
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}

export function createSqliteMemoryAdapter(opts: SqliteMemoryAdapterOptions): SqliteMemoryAdapter {
  return new SqliteMemoryAdapter(opts);
}

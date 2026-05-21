import type { Disposable, Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { Listable, MemoryAdapter, MemoryError } from '@idriszade/memory';

/**
 * Minimal type-only description of the orchestr8-mcp SQLiteBackend
 * sufficient for this adapter. Avoids importing the full orchestr8-mcp
 * package in a way that would break tree-shaking — consumers provide
 * an already-initialised instance.
 */
export interface OrchestrEntry {
  id: string;
  key: string;
  content: string;
  type: string;
  namespace: string;
  tags: string[];
  metadata: Record<string, unknown>;
  version: number;
  accessCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface OrchestrBackend {
  store(entry: OrchestrEntry): Promise<void>;
  retrieve(key: string, namespace?: string): Promise<{ id: string; content: string } | undefined>;
  query(query: {
    type: string;
    namespace?: string;
    keyPrefix?: string;
  }): Promise<Array<{ entry: { key: string } }>>;
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface Orchestr8MemoryAdapterOptions {
  /** Already-initialised SQLiteBackend (call backend.initialize() before passing). */
  backend: OrchestrBackend;
  /** Construction-time namespace (default: 'default'). */
  namespace?: string;
}

function makeMemoryEntry(key: string, content: string, namespace: string): OrchestrEntry {
  const now = Date.now();
  return {
    id: `pk_mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
    key,
    content,
    type: 'working',
    namespace,
    tags: [],
    metadata: {},
    version: 1,
    accessCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export class Orchestr8MemoryAdapter implements MemoryAdapter, Disposable, Listable {
  readonly #backend: OrchestrBackend;
  readonly #namespace: string;
  #closed = false;

  constructor(opts: Orchestr8MemoryAdapterOptions) {
    this.#backend = opts.backend;
    this.#namespace = opts.namespace ?? 'default';
  }

  #unavailableErr(): Result<never, MemoryError> {
    return err({
      type: 'memory_error',
      code: 'memory_unavailable',
      message: 'orchestr8 backend is closed',
    } satisfies MemoryError);
  }

  async read(key: string): Promise<Result<string | null, MemoryError>> {
    if (this.#closed) return this.#unavailableErr();
    try {
      const entry = await this.#backend.retrieve(key, this.#namespace);
      return ok(entry !== undefined ? entry.content : null);
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }

  /**
   * LWW wrap (BINDING per ADR V-4 + RF-3):
   * orchestr8 `store()` is silent-first-write-wins. Kit enforces LWW by
   * checking for an existing entry and deleting it before re-storing.
   *
   *   1. retrieve(key, ns)          → present? go to step 2; absent? go to step 3
   *   2. delete(existing.id)        → clear the stale row
   *   3. store(newEntry)            → write new value
   */
  async write(key: string, value: string): Promise<Result<void, MemoryError>> {
    if (this.#closed) return this.#unavailableErr();
    try {
      const existing = await this.#backend.retrieve(key, this.#namespace);
      if (existing !== undefined) {
        await this.#backend.delete(existing.id);
      }
      const entry = makeMemoryEntry(key, value, this.#namespace);
      await this.#backend.store(entry);
      return ok(undefined);
    } catch (e) {
      return err({
        type: 'memory_error',
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      } satisfies MemoryError);
    }
  }

  /**
   * List all unique keys in the given namespace, sorted alphabetically.
   * Uses `backend.query({ type: 'prefix', namespace, keyPrefix: '' })`.
   * De-duplicates because orchestr8 may store multiple rows per key if
   * the LWW wrap is bypassed externally.
   */
  async list(namespace: string): Promise<Result<string[], MemoryError>> {
    if (this.#closed) return this.#unavailableErr();
    try {
      const rows = await this.#backend.query({
        type: 'prefix',
        namespace,
        keyPrefix: '',
      });
      const seen = new Set<string>();
      const keys: string[] = [];
      for (const r of rows) {
        if (!seen.has(r.entry.key)) {
          seen.add(r.entry.key);
          keys.push(r.entry.key);
        }
      }
      keys.sort();
      return ok(keys);
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
    await this.#backend.close();
  }
}

export function createOrchestr8MemoryAdapter(
  opts: Orchestr8MemoryAdapterOptions,
): Orchestr8MemoryAdapter {
  return new Orchestr8MemoryAdapter(opts);
}

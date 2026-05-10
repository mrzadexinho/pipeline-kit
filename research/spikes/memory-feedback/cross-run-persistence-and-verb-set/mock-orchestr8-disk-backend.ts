// Cat V spike #3 — disk-backed orchestr8 wrap.
// Lifts spike #2 β contract verbatim:
//   MemoryAdapter = { read, write }
//   Disposable    = { close }
// Adds spike #3 verb-growth probe as a separate opt-in marker:
//   Listable      = { list(namespace) -> Result<string[], MemoryError> }
//
// Wire path: orchestr8-mcp's SQLiteBackend(filePath) — real-disk file,
// NOT ':memory:'. Durability is the spike-3 axis. The backend's
// autoSave() in store() writes the full sql.js DB to disk on each
// write; close() then closes the in-process handle. Two `bun run`
// invocations + a process exit between them = the durability boundary.
//
// Adapter author opts in to Listable + Disposable explicitly. The mock
// SecretsResolver opts into NEITHER and pays NO verb cost (axis β.3).

import { SQLiteBackend, createMemoryEntry } from 'orchestr8-mcp/dist/memory/index.js';

// --- Local Result<T, E> (no kit dep; mirrors ADR4 shape) ---
export type Ok<T> = { data: T; error: null };
export type Err<E> = { data: null; error: E };
export type Result<T, E> = Ok<T> | Err<E>;
export const ok = <T>(data: T): Ok<T> => ({ data, error: null });
export const err = <E>(error: E): Err<E> => ({ data: null, error });

// --- MemoryError envelope (kit conventions: type/code/message) ---
export type MemoryErrorCode = 'memory_unavailable' | 'aborted' | 'unknown';
export interface MemoryError {
  type: 'memory_error';
  code: MemoryErrorCode;
  message: string;
  param?: string;
}

// === Spike-2 β contract baseline (lifted verbatim) ====================
export interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}

export interface Disposable {
  close(): Promise<Result<void, MemoryError>>;
}

// === Spike-3 verb-growth probe — opt-in marker, parallel to Disposable ==
// `Listable` returns the full set of keys in a namespace. The cell-β
// driver narrows `'list' in deps.memory` to call this; deps that don't
// implement Listable get nothing forced on them (axis β.3 sibling-cost).
export interface Listable {
  list(namespace: string): Promise<Result<string[], MemoryError>>;
}

// --- Type-guards (parallel to spike-2's isDisposable) ------------------
export function isDisposable(x: unknown): x is Disposable {
  return (
    typeof x === 'object' &&
    x !== null &&
    'close' in x &&
    typeof (x as { close?: unknown }).close === 'function'
  );
}

export function isListable(x: unknown): x is Listable {
  return (
    typeof x === 'object' &&
    x !== null &&
    'list' in x &&
    typeof (x as { list?: unknown }).list === 'function'
  );
}

// --- Adapter type for spike-3: MemoryAdapter & Disposable & Listable ---
export type Orchestr8DiskAdapter = MemoryAdapter & Disposable & Listable;

// --- Adapter factory ---------------------------------------------------
// `namespace` is a CONSTRUCTION-TIME argument (per Cat VIII deps-shape
// discipline — adapter is namespace-bound at construction; reads/writes
// scope through that namespace; no namespace primitive on the verb shape).
// The `composedKey` convention `<spike-3-namespace>::<atom-id>` is a
// CONVENTION used by the call sites for cross-cell readability; the
// adapter itself just sees an opaque key.
export interface DiskAdapterOpts {
  namespace: string;
  databasePath: string;
}

export async function createOrchestr8DiskMemoryAdapter(
  opts: DiskAdapterOpts,
): Promise<Result<Orchestr8DiskAdapter, MemoryError>> {
  let backend: SQLiteBackend | null = null;
  try {
    backend = new SQLiteBackend({ databasePath: opts.databasePath });
    await backend.initialize();
  } catch (e) {
    return err({
      type: 'memory_error',
      code: 'memory_unavailable',
      message: `orchestr8 SQLiteBackend init failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  // Local non-null binding the closures capture. (TS narrows)
  const b = backend;
  const ns = opts.namespace;

  const adapter: Orchestr8DiskAdapter = {
    async read(key) {
      try {
        const entry = await b.retrieve(key, ns);
        return ok(entry === undefined ? null : entry.content);
      } catch (e) {
        return err({
          type: 'memory_error',
          code: 'unknown',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    async write(key, value) {
      try {
        const entry = createMemoryEntry({
          key,
          content: value,
          namespace: ns,
          type: 'working',
        });
        await b.store(entry);
        return ok(undefined);
      } catch (e) {
        return err({
          type: 'memory_error',
          code: 'unknown',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    async list(listNamespace) {
      // verb-growth probe: enumerate all keys in a namespace.
      // backed by orchestr8 query({ type: 'prefix', namespace, keyPrefix: '' })
      // — empty prefix is treated as falsy by the backend, so the
      // resulting WHERE clause is `namespace = ?`, returning all
      // entries. ORDER BY updated_at DESC (deterministic).
      try {
        const rows = await b.query({
          type: 'prefix',
          namespace: listNamespace,
          keyPrefix: '',
        });
        // De-dupe — note duplicate-key semantics surfaced by α.2:
        // orchestr8 stores each write as a fresh row (PRIMARY KEY on
        // synthesised id), so a key written N times appears N times in
        // query results. list() callers semantically want UNIQUE keys.
        const seen = new Set<string>();
        const keys: string[] = [];
        for (const r of rows) {
          if (!seen.has(r.entry.key)) {
            seen.add(r.entry.key);
            keys.push(r.entry.key);
          }
        }
        return ok(keys);
      } catch (e) {
        return err({
          type: 'memory_error',
          code: 'unknown',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    async close() {
      try {
        await b.close();
        return ok(undefined);
      } catch (e) {
        return err({
          type: 'memory_error',
          code: 'unknown',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
  };
  return ok(adapter);
}

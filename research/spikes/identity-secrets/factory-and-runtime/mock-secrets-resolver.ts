// Cat VIII spike #3 — shared mock SecretsResolver fixture (factory-and-runtime).
// Forked from spike #2 mock; rotation NOT stressed in this spike but
// invalidate/stats affordances kept verbatim for spike-#4 re-stress.
//
// Same Result<T, E>, same SecretsError envelope, same name regex, same error
// codes. Per-secret read counter + version tag exposed via stats(name) so
// the harness can prove "did the resolver actually re-fetch from source?"
// across the two-site (factory-time + run-time) read pattern.
// Caching is NOT done in the resolver; it always returns the current value.

// --- Result<T, E> (ADR4 mirror) ---
export type Ok<T> = { data: T; error: null };
export type Err<E> = { data: null; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(data: T): Ok<T> => ({ data, error: null });
export const err = <E>(error: E): Err<E> => ({ data: null, error });

// --- SecretsError (kit conventions: type/code/message/param) ---
export type SecretsErrorCode = 'secret_not_found' | 'malformed_name';
export interface SecretsError {
  type: 'secrets_error';
  code: SecretsErrorCode;
  message: string;
  param?: string;
}

// --- Stats shape ---
export interface SecretStats {
  reads: number;
  current_version: number;
}

// --- Resolver shape ---
export interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
  invalidate(name: string): Result<void, SecretsError>;
  stats(name: string): Result<SecretStats, SecretsError>;
}

// --- Validation: kit-shape names are lowercase + hyphen + alnum, ≥1 char ---
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// --- Internal store entry ---
interface Entry {
  base: string;
  value: string;
  version: number;
  reads: number;
}

const malformed = (name: string): Err<SecretsError> =>
  err({
    type: 'secrets_error',
    code: 'malformed_name',
    message: `secret name '${name}' is not kit-shape (a-z0-9-, lower)`,
    param: name,
  });

const notFound = (name: string): Err<SecretsError> =>
  err({
    type: 'secrets_error',
    code: 'secret_not_found',
    message: `no secret registered under '${name}'`,
    param: name,
  });

// --- Factory: create a fresh, isolated resolver instance.
// Each instance has its own store + counters — important for honest
// per-cell comparisons across factory-and-runtime sub-cases.
export function createMockSecretsResolver(): SecretsResolver {
  const store = new Map<string, Entry>();
  store.set('apify-token', {
    base: 'apify-tok-v1',
    value: 'apify-tok-v1',
    version: 1,
    reads: 0,
  });
  store.set('supabase-service-role', {
    base: 'sb-srv-v1',
    value: 'sb-srv-v1',
    version: 1,
    reads: 0,
  });

  return {
    async resolve(name) {
      // Keep async honest — yield to the event loop once.
      await Promise.resolve();
      if (!NAME_RE.test(name)) return malformed(name);
      const entry = store.get(name);
      if (entry === undefined) return notFound(name);
      entry.reads += 1;
      return ok(entry.value);
    },
    invalidate(name) {
      if (!NAME_RE.test(name)) return malformed(name);
      const entry = store.get(name);
      if (entry === undefined) return notFound(name);
      entry.version += 1;
      entry.value = `${entry.base}-rotated-v${entry.version}`;
      return ok(undefined);
    },
    stats(name) {
      if (!NAME_RE.test(name)) return malformed(name);
      const entry = store.get(name);
      if (entry === undefined) return notFound(name);
      return ok({ reads: entry.reads, current_version: entry.version });
    },
  };
}

// Default singleton (NOT shared across variant files — each main()
// constructs its own via createMockSecretsResolver() to keep counters
// honest). Exported for backward-compat with spike-#1/#2-shaped imports.
export const mockSecretsResolver: SecretsResolver = createMockSecretsResolver();

// Cat V spike #3 — mock SecretsResolver fixture, lifted verbatim from
// Cat V spike #2 (`research/spikes/memory-feedback/lifecycle-and-disposable/
// mock-secrets-resolver.ts`), itself lifted from Cat VIII spike #1.
// Lifecycle-free + verb-set-frozen by construction; the whole point of
// axes β.3 (sibling-cost) is to confirm this lifecycle/verb-free dep
// pays NO cost when the memory adapter grows lifecycle (Disposable) or
// verbs (Listable).
//
// Self-contained: redefines Result<T, E> locally (no kit dep).

// --- Result<T, E> (ADR4 mirror) ---
export type Ok<T> = { data: T; error: null };
export type Err<E> = { data: null; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(data: T): Ok<T> => ({ data, error: null });
export const err = <E>(error: E): Err<E> => ({ data: null, error });

// --- SecretsError (kit conventions: type/code/message) ---
export type SecretsErrorCode = 'secret_not_found' | 'malformed_name';
export interface SecretsError {
  type: 'secrets_error';
  code: SecretsErrorCode;
  message: string;
  param?: string;
}

// --- Resolver shape (lifecycle-free, verb-frozen) ---
export interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
}

// --- Fixture data ---
const STORE: Readonly<Record<string, string>> = Object.freeze({
  'apify-token': 'fake-tok-xyz',
  'supabase-service-role': 'fake-srv-abc',
});

// --- Validation: kit-shape names are lowercase + hyphen + alnum, ≥1 char ---
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// --- Implementation ---
export const mockSecretsResolver: SecretsResolver = {
  async resolve(name: string): Promise<Result<string, SecretsError>> {
    await Promise.resolve();
    if (!NAME_RE.test(name)) {
      return err({
        type: 'secrets_error',
        code: 'malformed_name',
        message: `secret name '${name}' is not kit-shape (a-z0-9-, lower)`,
        param: name,
      });
    }
    const value = STORE[name];
    if (value === undefined) {
      return err({
        type: 'secrets_error',
        code: 'secret_not_found',
        message: `no secret registered under '${name}'`,
        param: name,
      });
    }
    return ok(value);
  },
};

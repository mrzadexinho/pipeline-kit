import type { ErrorEnvelope } from '../envelope.js';
import type { Result } from '../result.js';
import { err, ok } from '../result.js';
import type { WireDecodeError } from './types.js';

export type DecodedResult<T, E> = { kind: 'ok'; value: T } | { kind: 'err'; error: E };

/**
 * Sanctioned cross-runtime Result discriminator (ADR IX-3).
 *
 * Funnels the convention-not-tag check (every cross-runtime hop reimplements `error == null`)
 * into one helper, surfacing typo guards.
 *
 * - `data !== null && error === null`  -> `ok({ kind: 'ok', value: data })`
 * - `data === null && error !== null`  -> `ok({ kind: 'err', error })`
 * - both null OR both non-null         -> `err({ code: 'wire/result_ambiguous' })`
 */
export function decodeResult<T, E = ErrorEnvelope>(raw: {
  data: T | null;
  error: E | null;
}): Result<DecodedResult<T, E>, WireDecodeError> {
  const hasData = raw.data !== null;
  const hasError = raw.error !== null;

  if (hasData && !hasError) {
    return ok({ kind: 'ok', value: raw.data as T });
  }

  if (!hasData && hasError) {
    return ok({ kind: 'err', error: raw.error as E });
  }

  // Both null or both non-null — ambiguous
  return err({
    code: 'wire/result_ambiguous',
    message:
      !hasData && !hasError
        ? 'Both data and error are null; cannot determine result branch'
        : 'Both data and error are non-null; result is ambiguous',
  });
}

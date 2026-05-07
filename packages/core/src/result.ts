import type { ErrorEnvelope } from './envelope.js';

export type Result<T, E = ErrorEnvelope> = { data: T; error: null } | { data: null; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ data, error: null });

export const err = <E = ErrorEnvelope>(error: E): Result<never, E> => ({
  data: null,
  error,
});

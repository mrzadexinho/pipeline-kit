import type { ServeError } from '@pipeline-kit/core';

export function makeServeError(
  type: ServeError['type'],
  code: string,
  message: string,
): ServeError {
  // `as ServeError` is required: `type` is the union of all discriminant literals,
  // so TypeScript cannot narrow { type, code, message } to a specific union member
  // without exhaustive branching. code + message come from BaseError (all optional
  // fields omitted here are optional). This is a deliberate narrowing cast.
  const err = { type, code, message };
  return err as ServeError;
}

export function generateEmitId(): string {
  return `pk_emit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

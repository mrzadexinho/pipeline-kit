import type { PipelineContext } from '../context.js';
import type { ProcessError } from '../errors/process.js';
import type { RunError } from '../errors/run.js';
import type { ServeError } from '../errors/serve.js';
import type { SourceError } from '../errors/source.js';
import type { StoreError } from '../errors/store.js';
import type { ComposerStep } from './composer.js';

// ---------------------------------------------------------------------------
// Internal shared types (private to the composer module)
// ---------------------------------------------------------------------------

export type StageCause = { type: string; code: string; message: string; retry_after_ms?: number };
export type AtomMeta = {
  atom_id: string;
  atoms_attempted: number;
  atoms_completed: number;
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function sourceIterError(e: unknown, requestId: string): RunError {
  const message = e instanceof Error ? e.message : String(e);
  return {
    type: 'source_failed',
    code: 'source_iter_failed',
    message,
    request_id: requestId,
    cause: { type: 'unknown', code: 'source_iter_failed', message } as SourceError,
  };
}

export function toRunError(
  step: ComposerStep,
  cause: StageCause,
  ctx: PipelineContext,
  atomMeta?: AtomMeta,
): RunError {
  const metadata = atomMeta
    ? {
        atom_id: atomMeta.atom_id,
        atoms_attempted: atomMeta.atoms_attempted,
        atoms_completed: atomMeta.atoms_completed,
      }
    : undefined;

  if (cause.type === 'cancelled') {
    return {
      type: 'cancelled',
      code: 'pipeline_cancelled',
      message: cause.message,
      request_id: ctx.runId,
      ...(metadata ? { metadata } : {}),
    };
  }
  const base = {
    code: `${step.kind}_failed`,
    message: cause.message,
    request_id: ctx.runId,
    ...(metadata ? { metadata } : {}),
  };
  switch (step.kind) {
    case 'source':
      return { type: 'source_failed', ...base, cause: cause as SourceError };
    case 'process':
    case 'review':
      return { type: 'process_failed', ...base, cause: cause as ProcessError };
    case 'serve':
      return { type: 'serve_failed', ...base, cause: cause as ServeError };
    case 'store':
      return { type: 'store_failed', ...base, cause: cause as StoreError };
    default:
      return { type: 'unknown', code: 'composer_unknown_stage', message: cause.message };
  }
}

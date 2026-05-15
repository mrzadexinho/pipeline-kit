/**
 * Inline kit type definitions for type-level probes.
 * Mirrors packages/core/src/ interfaces exactly — no runtime deps.
 *
 * This pattern follows cat-vi spikes: define types inline, probe structure
 * without needing node_modules in the spike directory.
 */

// ---------------------------------------------------------------------------
// Result<T,E>
// ---------------------------------------------------------------------------
export type Result<T, E = BaseError> =
  | { data: T; error: null }
  | { data: null; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ data, error: null });
export const err = <E>(error: E): Result<never, E> => ({ data: null, error });

// ---------------------------------------------------------------------------
// BaseError / ProcessError
// ---------------------------------------------------------------------------
export interface BaseError {
  code: string;
  message: string;
  param?: string;
  doc_url?: string;
  metadata?: Record<string, unknown>;
}

export type ProcessError =
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'permanent' })
  | (BaseError & { type: 'timeout' })
  | (BaseError & { type: 'validation' })
  | (BaseError & { type: 'process'; reason?: string })
  | (BaseError & { type: 'unknown' });

export type ServeError =
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'permanent' })
  | (BaseError & { type: 'rate_limited' })
  | (BaseError & { type: 'auth' })
  | (BaseError & { type: 'unknown' });

export type SourceError =
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'permanent' })
  | (BaseError & { type: 'unknown' });

export type RunError =
  | (BaseError & { type: 'transient' })
  | (BaseError & { type: 'permanent' })
  | (BaseError & { type: 'unknown' });

// ---------------------------------------------------------------------------
// PipelineContext (minimal)
// ---------------------------------------------------------------------------
export interface PipelineContext {
  readonly runId: string;
  readonly pipelineId: string;
  readonly attempt: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  attachMetadata(key: string, value: unknown): void;
}

// ---------------------------------------------------------------------------
// Atom<T>
// ---------------------------------------------------------------------------
export interface Atom<T> {
  readonly id: string;
  readonly object: 'atom';
  readonly created_at: string;
  readonly metadata: Record<string, unknown>;
  readonly data: T;
  readonly run_id: string;
  readonly stage_id: string;
}

// ---------------------------------------------------------------------------
// Stage interfaces
// ---------------------------------------------------------------------------
export interface Process<I, O> {
  readonly id: string;
  run(input: I, ctx: PipelineContext): Promise<Result<O, ProcessError>>;
}

export interface Source<O> {
  readonly id: string;
  iter(query: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<O>>;
  fetch(query: Record<string, unknown> | undefined, ctx: PipelineContext): Promise<Result<Atom<O>[], SourceError>>;
}

export interface EmitResult {
  id: string;
  emitted_at: string;
  metadata: Record<string, unknown>;
}

export interface Serve<I> {
  readonly id: string;
  emit(input: I, ctx: PipelineContext): Promise<Result<EmitResult, ServeError>>;
}

// ---------------------------------------------------------------------------
// Pipeline builder types (mirrors pipeline-types.ts)
// ---------------------------------------------------------------------------
export interface RunOptions {
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface RunResult<O> {
  runId: string;
  pipelineId: string;
  output: O;
  atomCount: number;
  duration: number;
  metadata: Record<string, unknown>;
}

export interface TerminalPipeline<O> {
  run(input?: unknown, options?: RunOptions): Promise<Result<RunResult<O>, RunError>>;
}

export interface SourcePipeline<O> {
  through<Out>(process: Process<O, Out>): SourcePipeline<Out>;
  to(serve: Serve<O>): TerminalPipeline<O>;
}

// ---------------------------------------------------------------------------
// Minimal Pipeline builder (structural stub — not a runtime implementation)
// Used to verify that .through().through()...to() type-chains compile correctly.
// ---------------------------------------------------------------------------

// Stub implementation for type verification only
function makeSourcePipeline<O>(): SourcePipeline<O> {
  return {
    through<Out>(_process: Process<O, Out>): SourcePipeline<Out> {
      return makeSourcePipeline<Out>();
    },
    to(_serve: Serve<O>): TerminalPipeline<O> {
      return {
        async run(_input?: unknown, _options?: RunOptions): Promise<Result<RunResult<O>, RunError>> {
          // Stub: never called in type-level probes
          return err({ type: 'unknown' as const, code: 'stub', message: 'stub implementation' });
        },
      };
    },
  };
}

export const Pipeline = {
  from<O>(_source: Source<O>): SourcePipeline<O> {
    return makeSourcePipeline<O>();
  },
};

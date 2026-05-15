/**
 * kit-types.ts — Inline type definitions for Cat II spike probes.
 *
 * All types defined inline so probes have zero external imports.
 * These mirror the M0 kit surface faithfully (Result<T,E>, Atom<T>,
 * PipelineContext, stage shapes) without importing from kit packages.
 */

// ---------------------------------------------------------------------------
// Core result type
// ---------------------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Atom — the unit of data that flows through stages
// ---------------------------------------------------------------------------

export type Atom<T> = {
  id: string;
  object: "atom";
  created_at: number;
  data: T;
  metadata: Record<string, unknown>;
};

export function makeAtom<T>(id: string, data: T, meta: Record<string, unknown> = {}): Atom<T> {
  return { id, object: "atom", created_at: Date.now(), data, metadata: meta };
}

// ---------------------------------------------------------------------------
// StageError — structured error type for all stage outputs
// ---------------------------------------------------------------------------

export type StageError = {
  type: "stage_error";
  code: string;           // e.g. AGENT_TOOL_ERROR, AGENT_MAX_TURNS
  message: string;
  retryable: boolean;
  param?: string;
  doc_url?: string;
};

export function stageErr(
  code: string,
  message: string,
  retryable: boolean,
  extra?: Partial<Pick<StageError, "param" | "doc_url">>,
): StageError {
  return { type: "stage_error", code, message, retryable, ...extra };
}

// ---------------------------------------------------------------------------
// PipelineContext — ambient context passed to every stage
// ---------------------------------------------------------------------------

export type PipelineContext = {
  runId: string;
  signal: AbortSignal;
  attempt: number;
  deps: Record<string, unknown>;
  trace: { traceparent: string };
};

export function makeCtx(
  runId: string,
  deps: Record<string, unknown> = {},
  signal?: AbortSignal,
): PipelineContext {
  const ctrl = new AbortController();
  return {
    runId,
    signal: signal ?? ctrl.signal,
    attempt: 1,
    deps,
    trace: { traceparent: `00-${runId.replace(/-/g, "")}-0000000000000001-01` },
  };
}

// ---------------------------------------------------------------------------
// Stage type aliases
// ---------------------------------------------------------------------------

/** Source: emits atoms from an external data source */
export type Source<O> = (ctx: PipelineContext) => AsyncIterable<Atom<O>>;

/** Process: transforms one atom into a Result<O, StageError> */
export type Process<I, O> = (
  atom: Atom<I>,
  ctx: PipelineContext,
) => Promise<Result<O, StageError>>;

/** Store: writes atom to durable storage, returns receipt */
export type Store<T> = (
  atom: Atom<T>,
  ctx: PipelineContext,
) => Promise<Result<{ stored: true; key: string }, StageError>>;

/** Serve: exposes pipeline output via a protocol adapter */
export type Serve<I> = (
  atom: Atom<I>,
  ctx: PipelineContext,
) => Promise<Result<void, StageError>>;

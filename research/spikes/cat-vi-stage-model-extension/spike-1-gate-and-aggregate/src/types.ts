/**
 * Cat VI spike #1 — shared types and type-level exploration.
 *
 * Self-contained: no @idriszade/* imports (throwaway spike).
 *
 * Purpose: probe whether Gate<I> and Aggregate<I[],O> require new stage type
 * interfaces or whether TypeScript's generic system already expresses them as
 * specialisations of Process<I,O>.
 */

// ---------------------------------------------------------------------------
// Result<T, E>  — mirrors kit's ADR shape (err-envelope, no thrown errors)
// ---------------------------------------------------------------------------

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// StageError — kit's error envelope shape (type/code/message/param/doc_url)
// ---------------------------------------------------------------------------

export interface StageError {
  type: "stage_error";
  code:
    | "gate_rejected"
    | "gate_held"
    | "aggregate_incomplete"
    | "process_failed"
    | "invalid_input"
    | "unknown";
  message: string;
  param?: string;
  doc_url?: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Atom<T>  — kit envelope (id / object / created_at / metadata / data)
// ---------------------------------------------------------------------------

export interface Atom<T> {
  id: string;
  object: "atom";
  created_at: number;
  metadata: Record<string, unknown>;
  data: T;
}

export function makeAtom<T>(
  id: string,
  data: T,
  meta?: Record<string, unknown>,
): Atom<T> {
  return {
    id,
    object: "atom",
    created_at: Date.now(),
    metadata: meta ?? {},
    data,
  };
}

// ---------------------------------------------------------------------------
// PipelineContext — run-scope (signal, run_id); stage deps NOT here per ADR
// ---------------------------------------------------------------------------

export interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Existing kit stage types (simplified for structural probe)
// ---------------------------------------------------------------------------

/** Source<O>: pulls atoms; AsyncIterable captures backpressure naturally. */
export interface Source<O> {
  id: string;
  pull(ctx: PipelineContext): AsyncIterable<Result<Atom<O>, StageError>>;
}

/** Process<I, O>: transforms a single input atom → single output atom. */
export interface Process<I, O> {
  id: string;
  run(
    atom: Atom<I>,
    ctx: PipelineContext,
  ): Promise<Result<Atom<O>, StageError>>;
}

/** Serve<I>: consumes an atom with side-effects; returns Result<void>. */
export interface Serve<I> {
  id: string;
  push(atom: Atom<I>, ctx: PipelineContext): Promise<Result<void, StageError>>;
}

// ---------------------------------------------------------------------------
// Proposed Gate<I> — Option A: dedicated stage type
// ---------------------------------------------------------------------------

/**
 * GateDecision<I>: the four actions a gate may take on an atom.
 *
 * Key structural question: does this discriminated union carry type-level
 * information that Process<I, I> cannot express?
 *
 * - "pass"      — atom flows through unchanged (identity transform)
 * - "transform" — atom is mutated before flowing through (still type I)
 * - "hold"      — atom is suspended; maps to HRP waitForEvent (Cat I ADR-I-5)
 * - "reject"    — atom is permanently dropped; maps to NonRetryable (ADR-I-3)
 */
export type GateDecision<I> =
  | { action: "pass"; atom: Atom<I> }
  | { action: "transform"; atom: Atom<I> }
  | { action: "hold"; reason: string; timeout?: string }
  | { action: "reject"; reason: string };

/** Option A: Gate<I> as a dedicated stage type with evaluate() method. */
export interface GateA<I> {
  type: "gate";
  id: string;
  evaluate(
    atom: Atom<I>,
    ctx: PipelineContext,
  ): Promise<GateDecision<I>>;
}

/**
 * Option B: Gate<I> as Process<I, I>.
 *
 * Process<I, I> where:
 * - ok(outputAtom)   → pass / transform (identity or mutation)
 * - err(StageError where code='gate_rejected', retryable=false) → reject
 * - err(StageError where code='gate_held', retryable=true)      → hold
 *
 * Type alias only — no new interface needed.
 */
export type GateB<I> = Process<I, I>;

/**
 * Option C: Gate as Composer config predicate — not a stage type at all.
 * The Composer wraps any Process with a gate predicate + hold/reject actions.
 * Modelled here as a config shape, not a stage interface.
 */
export interface GateComposerConfig<I> {
  predicate(atom: Atom<I>): Promise<GateDecision<I>>;
  holdAction?: "hrp_waitForEvent" | "delay_queue";
  timeout?: string;
}

// ---------------------------------------------------------------------------
// Proposed Aggregate<I[], O> — Option A: dedicated stage type
// ---------------------------------------------------------------------------

/**
 * WindowConfig: when does the aggregate fire?
 *
 * - count: N atoms accumulated → trigger
 * - time:  N milliseconds elapsed → trigger (even with partial batch)
 * - all:   source exhausted → trigger (finite pipelines only)
 *
 * This is the core SEMANTIC addition: a Process<I, O> cannot express
 * "wait for N atoms" — that's a Composer-level concern (buffering semantics).
 */
export type WindowConfig =
  | { type: "count"; n: number }
  | { type: "time"; ms: number }
  | { type: "all" };

/** Option A: Aggregate<I, O> as a dedicated stage type. */
export interface AggregateA<I, O> {
  type: "aggregate";
  id: string;
  window: WindowConfig;
  accumulate(
    atoms: Atom<I>[],
    ctx: PipelineContext,
  ): Promise<Result<Atom<O>, StageError>>;
}

/**
 * Option B: Process<I[], O> — array input instead of single atom.
 *
 * TypeScript already expresses this: Process<ClassifiedAtom[], SummaryAtom>.
 * The question is: who fills the array? If the Composer handles buffering
 * (via config), this reduces to a type alias.
 */
export type AggregateB<I, O> = Process<I[], O>;

/**
 * Option C: Source<SummaryAtom> that internally buffers from upstream.
 *
 * Inversion: the aggregate stage PULLS from upstream, fills its own buffer,
 * then emits a single aggregate atom. This is the Kafka KTable / Flink
 * WindowedStream pattern — the aggregation stage IS the source of
 * aggregated data.
 */
export interface AggregateC<I, O> {
  type: "buffering-source";
  id: string;
  window: WindowConfig;
  upstream: Source<I>;
  flush(
    atoms: Atom<I>[],
    ctx: PipelineContext,
  ): Promise<Result<Atom<O>, StageError>>;
  pull(ctx: PipelineContext): AsyncIterable<Result<Atom<O>, StageError>>;
}

// ---------------------------------------------------------------------------
// Process cardinality sub-types: TypeScript generics already express all 4
// ---------------------------------------------------------------------------

/**
 * 1:1 — the current Process<I, O>. No new type needed.
 * Example: classify(atom: Atom<RawText>) → Promise<Result<Atom<Classified>>>
 */
export type ProcessOneToOne<I, O> = Process<I, O>;

/**
 * 1:N — Process<I, O[]>. Split/route.
 * Already expressible. Example: a router that emits multiple branch atoms.
 * Note: cardinality change is in the PAYLOAD type, not the stage interface.
 */
export type ProcessOneToMany<I, O> = Process<I, O[]>;

/**
 * N:1 — Process<I[], O>. Aggregate (batch).
 * Already expressible via Process<I[], O>. Buffering is Composer's concern.
 */
export type ProcessManyToOne<I, O> = Process<I[], O>;

/**
 * 1:0 — Process<I, never>. Filter.
 *
 * Note: Result<Atom<never>, StageError> is weird — `never` means the ok path
 * is unreachable. In practice, a filter returns err() to drop.
 * More natural as a predicate: (atom: Atom<I>) => boolean.
 * This is the "Composer config" model — filter IS a Gate option C.
 */
export type ProcessFilter<I> = (atom: Atom<I>) => boolean;

// ---------------------------------------------------------------------------
// Reviewable<I> — v0 shipped type (for subsumption probe)
// ---------------------------------------------------------------------------

/**
 * Reviewable<I>: v0 HRP checkpoint shape.
 * Carries field-level editability + decision (approve/reject/edit) + timeout.
 *
 * Key question: is Gate<I> ⊇ Reviewable<I>?
 */
export interface EditableField<T> {
  value: T;
  editable: boolean;
  label?: string;
}

export type ReviewDecision<I> =
  | { decision: "approve"; atom: Atom<I> }
  | { decision: "reject"; reason: string }
  | { decision: "edit"; atom: Atom<I>; edits: Partial<I> };

export interface ReviewableI<I> {
  type: "reviewable";
  id: string;
  /** Presents atom for human review. Returns when review completes. */
  sendForReview(
    atom: Atom<I>,
    ctx: PipelineContext,
  ): Promise<ReviewDecision<I>>;
  /** Maps field-level edits back to atom payload. */
  applyEdits(atom: Atom<I>, edits: Partial<I>): Atom<I>;
  timeout?: string;
}

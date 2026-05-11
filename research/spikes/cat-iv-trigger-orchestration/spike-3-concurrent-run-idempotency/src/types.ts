/**
 * Cat IV Spike #3 — Dedup taxonomy types
 *
 * Self-contained: no @idriszade/* imports (throwaway spike).
 *
 * Three concerns that get conflated when reasoning about concurrent runs:
 *
 * 1. CONCURRENCY CONTROL — "at most N runs active simultaneously"
 *    Owner: runtime (Inngest concurrency config, Temporal worker slots)
 *    Mechanism: queue + limit; excess runs wait, not rejected
 *
 * 2. DEDUPLICATION — "this exact event/trigger was already processed"
 *    Owner: ??? — this spike's primary question
 *    Mechanism: idempotency key + window; duplicate rejected, not queued
 *
 * 3. SINGLETON — "only one active INSTANCE of this pipeline at a time"
 *    Owner: ??? — concurrency=1 or explicit lock?
 *    Mechanism: either concurrency limit OR dedup key tied to pipeline state
 *
 * These three are orthogonal:
 *   - concurrency=1 IS singleton (one active at a time) but NOT dedup
 *     (the second fire is queued, not rejected — will run after first completes)
 *   - dedup IS rejection (second fire is dropped entirely — never runs)
 *   - singleton ≠ "run exactly once" unless combined with dedup
 */

// ---------------------------------------------------------------------------
// IdempotencyKey — a value that uniquely identifies a unit of work
// ---------------------------------------------------------------------------

/**
 * An IdempotencyKey is a stable string that, when seen twice within a
 * DedupWindow, means "this is the same work request — do not process again."
 *
 * Critically: the key must be computable WITHOUT running the pipeline.
 * It is computed at the INPUT boundary (trigger / Serve) before any processing.
 */
export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };

export function makeIdempotencyKey(raw: string): IdempotencyKey {
  return raw as IdempotencyKey;
}

// ---------------------------------------------------------------------------
// DedupWindow — how long an idempotency key is "remembered"
// ---------------------------------------------------------------------------

/**
 * The time window in which a duplicate IdempotencyKey is recognized.
 *
 * - Inngest: 24h event-level dedup window (built-in)
 * - SQS: 5-minute content-based dedup window (non-configurable)
 * - pg-boss: singletonSeconds (configurable)
 * - kit Serve (v0): timestamp tolerance (HMAC signature validity window)
 */
export interface DedupWindow {
  /** Duration string e.g. "5m", "24h", "forever" */
  readonly period: string;
  /** If true, the key is remembered permanently (idempotency never expires) */
  readonly permanent?: boolean;
}

// ---------------------------------------------------------------------------
// SingletonPolicy — which semantic does "one active run" mean?
// ---------------------------------------------------------------------------

/**
 * Policies for what happens when a second trigger fires while a run is active.
 *
 * These map to Temporal's WorkflowIdReusePolicy and Inngest's concurrency + dedup:
 *
 *   QUEUE      → queue the new run, execute after current completes (concurrency=1)
 *   REJECT     → drop the new run entirely (dedup, singleton key)
 *   TERMINATE  → cancel current, start new run immediately
 *   CONDITIONAL → run only if previous run failed
 */
export type SingletonPolicy =
  | { readonly type: "queue" }          // concurrency=1 — Inngest native
  | { readonly type: "reject" }         // dedup key + infinite window
  | { readonly type: "terminate" }      // cancel signal + new run
  | { readonly type: "conditional"; readonly condition: "previous-failed" };

// ---------------------------------------------------------------------------
// ConcurrencyConfig — runtime-owned; kit declares, runtime enforces
// ---------------------------------------------------------------------------

/**
 * Kit's declaration of concurrency intent.
 * The runtime (Inngest, Temporal) reads this and enforces.
 * Kit-core does NOT enforce concurrency limits — it has no scheduler.
 *
 * [STRUCTURAL-PREDICTION]: this shape maps 1:1 to Inngest's concurrency config
 * and can be trivially translated by the adapter layer.
 */
export interface ConcurrencyConfig {
  /** Maximum simultaneous active runs. Undefined = unbounded (default). */
  readonly limit?: number;
  /**
   * Key expression evaluated per event/run.
   * If provided, the limit applies per unique key value (not globally).
   * E.g. "event.data.pipelineId" limits to N concurrent runs per pipeline ID.
   */
  readonly key?: string;
  /**
   * What happens when limit is reached:
   *   "queue"  → excess runs wait (default for Inngest)
   *   "reject" → excess runs are rejected immediately
   */
  readonly overflow?: "queue" | "reject";
}

// ---------------------------------------------------------------------------
// RunGuard — the minimal config kit needs to DECLARE run-guard semantics
// ---------------------------------------------------------------------------

/**
 * RunGuard is kit's declaration of how concurrent / duplicate runs should
 * be handled. Kit defines the shape; the runtime + trigger layer enforce it.
 *
 * Ownership boundaries:
 *   - kit-core: defines RunGuard type + generates IdempotencyKey
 *   - adapter-inngest: translates RunGuard → Inngest concurrency + idempotency config
 *   - trigger layer: computes dedupKey before pipeline runs
 *   - runtime (Inngest): enforces concurrency limits, drops duplicates
 *
 * [STRUCTURAL-PREDICTION]: RunGuard is a Composer option, not a stage type.
 * It does not change the pipeline's data flow — it is pure scheduling metadata.
 */
export interface RunGuard {
  /**
   * Concurrency limit for this pipeline.
   * Absent = unbounded (any number of simultaneous runs).
   */
  readonly concurrency?: ConcurrencyConfig;

  /**
   * Singleton policy: what happens when a second trigger fires.
   * Absent = no singleton enforcement (multiple runs allowed).
   */
  readonly singleton?: SingletonPolicy;

  /**
   * Dedup window for input-side idempotency.
   * When provided, the trigger layer must supply a dedupKey on every TriggerEvent.
   * The runtime drops events whose dedupKey was seen within the window.
   * Absent = no dedup (every trigger fires a new run).
   */
  readonly dedup?: DedupWindow;
}

// ---------------------------------------------------------------------------
// TriggerEvent — the envelope that carries trigger metadata into the pipeline
// ---------------------------------------------------------------------------

/**
 * A TriggerEvent is what crosses the input boundary into kit's Composer.
 * It carries the source data PLUS scheduling metadata.
 *
 * Key field: dedupKey
 *   - Computed by the trigger layer BEFORE the pipeline runs
 *   - Used by the runtime to detect and drop duplicates
 *   - Never computed inside the pipeline (would defeat the purpose)
 *
 * [STRUCTURAL-PREDICTION]: this is the correct place for dedupKey.
 * Putting it inside the Composer or Process stage is too late — the run
 * has already started by the time any Process stage executes.
 */
export interface TriggerEvent<T> {
  readonly id: string;           // pk_src_… — unique event ID
  readonly object: "trigger_event";
  readonly created_at: number;
  readonly pipelineId: string;
  readonly data: T;
  /** Input-side idempotency key. Computed at trigger boundary, not inside pipeline. */
  readonly dedupKey?: IdempotencyKey;
  /** Scheduled time for cron triggers. Drives `${pipelineId}:${scheduledAt}` dedup key. */
  readonly scheduledAt?: number;
  readonly metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result<T, E> — mirrors kit's core type
// ---------------------------------------------------------------------------

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

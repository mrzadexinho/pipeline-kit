/**
 * Cat VI Spike #2 — two-plane-split: type exploration.
 *
 * Self-contained: no @idriszade/* imports (throwaway spike).
 * Strict TypeScript, ESM only. No runtime deps.
 *
 * Purpose: trace whether kit needs an ADR-level data/control-plane split
 * or whether PipelineContext + documented convention is sufficient.
 */

// ---------------------------------------------------------------------------
// Shared primitives (mirrored from Cat I + Cat V + Cat VIII spikes)
// ---------------------------------------------------------------------------

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export interface Atom<T> {
  readonly id: string;
  readonly object: "atom";
  readonly created_at: number;
  readonly metadata: Record<string, unknown>;
  readonly data: T;
}

// ---------------------------------------------------------------------------
// Adapter stubs (shape-only; no real implementations in this spike)
// ---------------------------------------------------------------------------

/** Cat V — MemoryAdapter (2-verb core contract per ADR-V-1). */
export interface MemoryAdapter {
  read(key: string): Promise<Result<unknown, MemoryError>>;
  write(key: string, value: unknown): Promise<Result<void, MemoryError>>;
}
export interface MemoryError {
  type: "memory_error";
  code: "memory_not_found" | "memory_write_failed" | "memory_backend_unavailable";
  message: string;
}

/** Cat VIII — SecretsResolver (single-verb per ADR-VIII-1). */
export interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
  invalidate(name: string): void; // carry-forward #7 from Cat VIII
}
export interface SecretsError {
  type: "secrets_error";
  code: "secret_not_found" | "secret_expired" | "secret_backend_unavailable";
  message: string;
}

/** W3C Trace Context (per ADR-v1-IX-4 — out-of-band of Atom data). */
export interface TraceContext {
  readonly traceparent: string; // W3C traceparent header value
  readonly tracestate?: string; // W3C tracestate (optional)
}

/** Minimal OTel span interface (structural — no otel package dep). */
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

// ---------------------------------------------------------------------------
// OPTION C — Status quo: flat PipelineContext (current v0 shape + v1 adds)
//
// This is what kit ships today plus the fields accumulated from prior cats:
// Cat I (runId, signal, attempt), Cat IV (idempotencyKey, dedupKey),
// Cat V (deps.memory), Cat VIII (deps.secrets), Cat IX (trace).
// ---------------------------------------------------------------------------

/** @plane control — kit owns; not user-visible in trace data by default. */
export interface PipelineContextOptionC {
  // --- run-scope (Cat I) ---
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly attempt: number;

  // --- durability (Cat IV, from carry-forwards) ---
  readonly idempotencyKey?: string;
  readonly dedupKey?: string;

  // --- OTel (Cat IX ADR-v1-IX-4: out-of-band, NOT in Atom data) ---
  readonly trace: TraceContext;

  // --- adapters (Cat V + Cat VIII — deps-shape pattern, NOT ctx ambient) ---
  // NOTE: per ADR-VIII-1 and ADR-V-1, adapters live on `deps`, not on ctx.
  // Shown here on ctx intentionally to represent the "Option A" ambient pattern
  // that the research is evaluating against.
  readonly deps: {
    readonly memory?: MemoryAdapter;
    readonly secrets?: SecretsResolver;
  };

  // --- user metadata (observable; visible in traces) ---
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// OPTION A — Explicit two-plane split: DataPlane<T> + ControlPlane
//
// Formalises the split in TypeScript types. Mirrors: Kafka (record vs header),
// gRPC (message vs metadata), HTTP (body vs headers),
// Temporal (activity payload vs workflow context).
// ---------------------------------------------------------------------------

/**
 * DataPlane<T> — the atom and its observable content.
 * Flows through stages, is the "pipeline content", subject to user inspection.
 * @plane data
 */
export interface DataPlane<T> {
  /** The atom being processed at this stage boundary. */
  readonly atom: Atom<T>;
}

/**
 * ControlPlane — infrastructure signals and run-scope metadata.
 * NOT the pipeline content. Not surfaced in traces by default.
 * @plane control
 */
export interface ControlPlane {
  // Cancellation
  readonly signal: AbortSignal;
  // Run identity
  readonly runId: string;
  readonly attempt: number;
  // Durability
  readonly idempotencyKey?: string;
  readonly dedupKey?: string;
  // OTel (W3C Trace Context out-of-band per ADR-v1-IX-4)
  readonly trace: TraceContext;
  // Adapter infrastructure
  readonly deps: {
    readonly memory?: MemoryAdapter;
    readonly secrets?: SecretsResolver;
  };
  // Kit-internal health / RunGuard (future Cat IV)
  readonly runGuard?: RunGuardState;
}

/** Placeholder for Cat IV RunGuard state — not yet designed. */
export interface RunGuardState {
  readonly concurrencySlot: number;
  readonly maxConcurrency: number;
  readonly queuedAt: number;
}

/**
 * Stage handler signature under Option A.
 *
 * Each stage receives BOTH planes explicitly.
 * The Composer threads both planes through the pipeline.
 */
export type StageFnA<I, O, E> = (
  data: DataPlane<I>,
  control: ControlPlane,
) => Promise<Result<Atom<O>, E>>;

// ---------------------------------------------------------------------------
// OPTION B — Annotated PipelineContext: documented split, no new types
//
// Single context object; JSDoc groups fields by plane.
// Convention enforced by documentation + lint rules (no new structural types).
// ---------------------------------------------------------------------------

/**
 * PipelineContext — single context object passed to all stage handlers.
 *
 * Fields are grouped by plane via JSDoc annotation:
 *
 * CONTROL PLANE — kit owns; not user-observable in traces by default.
 * DATA-ADJACENT PLANE — user-configured; visible in traces subject to redaction.
 * USER METADATA — fully observable; user writes + reads freely.
 *
 * This is Option B: one type, documented split, no structural ceremony.
 */
export interface PipelineContextOptionB {
  // --- CONTROL PLANE (kit owns; infrastructure; not observable by default) ---
  /** @control Abort signal for cooperative cancellation. Not serialisable. */
  readonly signal: AbortSignal;
  /** @control Unique run identifier. Prefixed: pk_run_<ulid>. */
  readonly runId: string;
  /** @control Step retry attempt index (0 = first attempt). */
  readonly attempt: number;
  /** @control W3C Trace Context for OTel propagation. Out-of-band of Atom data per ADR-v1-IX-4. */
  readonly trace: TraceContext;
  /** @control Idempotency key (Cat IV; optional until RunGuard lands). */
  readonly idempotencyKey?: string;
  /** @control Deduplication key (Cat IV; coarser granularity than idempotencyKey). */
  readonly dedupKey?: string;

  // --- DATA-ADJACENT PLANE (user-configured; subject to PII redaction per ADR-VIII-6) ---
  /** @data-adjacent Adapter dependencies injected at pipeline construction. */
  readonly deps: {
    /** MemoryAdapter (Cat V). Disposable — owns lifecycle. */
    readonly memory?: MemoryAdapter;
    /** SecretsResolver (Cat VIII). Non-serialisable — never crosses the wire. */
    readonly secrets?: SecretsResolver;
  };

  // --- USER METADATA (fully observable; user-owned; appears in traces) ---
  /** @user User-supplied key-value pairs. PII redaction applies (ADR-VIII-6). */
  metadata: Record<string, unknown>;
}

/**
 * Stage handler signature under Option B.
 *
 * Single context object; handler reads from the correct plane by convention.
 * Simpler call site than Option A.
 */
export type StageFnB<I, O, E> = (
  atom: Atom<I>,
  ctx: PipelineContextOptionB,
) => Promise<Result<Atom<O>, E>>;

// ---------------------------------------------------------------------------
// Wire-crossing context (Cat IX carry-forward #1)
//
// What subset of PipelineContext is SERIALISABLE and safe to cross the
// TS→Python wire? This is the natural boundary test for the two-plane
// hypothesis: if the serialisable fields map cleanly onto one plane,
// the split is empirically justified.
// ---------------------------------------------------------------------------

/**
 * SerializableContext — the subset of PipelineContext that CAN cross the wire.
 *
 * Fields: runId (string), trace (W3C strings), idempotencyKey (string?).
 * NOT included: signal (not serialisable), deps (not serialisable — Python has
 * its own adapters), metadata (may contain non-serialisable values).
 *
 * Observation: serialisable fields are a strict subset of the CONTROL PLANE
 * (option A), minus signal and deps. This partially supports the two-plane
 * hypothesis: the "wire-safe control" fields form a coherent group.
 */
export interface SerializableContext {
  readonly runId: string;
  readonly trace: TraceContext;
  readonly idempotencyKey?: string;
}

/**
 * NonSerializableContext — the subset that MUST NOT cross the wire.
 *
 * These are either runtime objects (AbortSignal), adapter references
 * (MemoryAdapter, SecretsResolver), or user metadata with unknown
 * serialisability.
 */
export interface NonSerializableContext {
  readonly signal: AbortSignal;
  readonly deps: PipelineContextOptionB["deps"];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Type-level verification: does Option B split cleanly at the wire boundary?
// ---------------------------------------------------------------------------

/**
 * Verify: SerializableContext keys are a proper subset of PipelineContextOptionB.
 * TypeScript structural subtyping test — compiles iff correct.
 */
function _assertWireSubset(ctx: PipelineContextOptionB): SerializableContext {
  return {
    runId: ctx.runId,
    trace: ctx.trace,
    idempotencyKey: ctx.idempotencyKey,
  };
}

// Suppress unused-variable lint without a runtime import.
void _assertWireSubset;

export type { };

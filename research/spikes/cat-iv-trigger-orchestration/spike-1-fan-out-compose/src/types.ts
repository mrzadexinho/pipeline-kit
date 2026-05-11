/**
 * Cat IV Spike #1 — shared types
 *
 * Self-contained: no @idriszade/* imports (throwaway spike).
 */

// ---------------------------------------------------------------------------
// Result<T, E>  (mirrors kit's type from Cat I spikes)
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
// Atom<T>  (kit envelope shape)
// ---------------------------------------------------------------------------

export interface Atom<T> {
  id: string;
  object: "atom";
  created_at: number;
  metadata: Record<string, unknown>;
  data: T;
}

export function makeAtom<T>(id: string, data: T): Atom<T> {
  return { id, object: "atom", created_at: Date.now(), metadata: {}, data };
}

// ---------------------------------------------------------------------------
// Fan-out event types (Inngest event payloads)
// ---------------------------------------------------------------------------

/** Parent trigger: request a fan-out over N items */
export interface FanOutEvent {
  name: "pipeline/fan-out-requested";
  data: {
    pipelineId: string;
    items: Array<{ id: string; payload: string }>;
  };
}

/** Child trigger: process a single item */
export interface ChildEvent {
  name: "pipeline/child-process";
  data: {
    item: { id: string; payload: string };
  };
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ItemInput {
  id: string;
  payload: string;
}

export interface ChildProcessOutput {
  itemId: string;
  processed: string;
  processedAt: number;
}

export interface AggregatedOutput {
  pipelineId: string;
  totalItems: number;
  succeeded: number;
  failed: number;
  results: Array<Result<ChildProcessOutput, ChildError>>;
  aggregatedAt: number;
}

export interface ChildError {
  code: "child_process_failed" | "child_item_rejected";
  itemId: string;
  message: string;
}

export interface FanOutError {
  code: "fan_out_failed" | "aggregate_failed";
  message: string;
  failedItems: string[];
}

export interface HrpReviewEvent {
  name: "hrp/review.completed";
  data: {
    runId: string;
    approved: boolean;
    reviewer: string;
  };
}

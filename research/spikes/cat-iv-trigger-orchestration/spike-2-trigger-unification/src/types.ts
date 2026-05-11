/**
 * Cat IV Spike #2 — trigger-unification types
 *
 * Core question: does Trigger<O> collapse to Source<O>, or is it a new stage type?
 *
 * Self-contained: no @idriszade/* imports, no Inngest (kit-level probe).
 * Strict TS / ESM.
 */

// ---------------------------------------------------------------------------
// Result<T,E>  — mirrors kit convention from Cat I/V spikes
// ---------------------------------------------------------------------------

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(v: T): Ok<T> {
  return { ok: true, value: v };
}
export function err<E>(e: E): Err<E> {
  return { ok: false, error: e };
}

// ---------------------------------------------------------------------------
// Atom<T>  — kit envelope shape (mirrors Cat I/IV spike #1)
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
// Option A: Trigger IS a Source specialisation
//
// Source<O> already produces atoms from external input.
// A cron trigger = Source that emits on schedule.
// A webhook trigger = Source that emits on HTTP POST.
// No new type needed — trigger is just Source config.
// ---------------------------------------------------------------------------

export interface Source<O> {
  type: "source";
  id: string;
  pull(): Promise<Result<Atom<O>[], SourceError>>;
}

export interface SourceError {
  type: "source_error";
  code: string;
  message: string;
}

/** Option A: trigger IS a Source — no Trigger<O> type exists */
export type TriggerAsSource<O> = Source<O>;

// ---------------------------------------------------------------------------
// Option B: Trigger is ABOVE Source (meta-layer)
//
// Trigger decides WHEN to invoke the pipeline.
// Source extracts atoms FROM the trigger context.
// Trigger = "when"; Source = "what".
// ---------------------------------------------------------------------------

/**
 * The event envelope a Trigger produces.
 * Source then receives this and extracts atoms from it.
 */
export interface TriggerEvent<O> {
  id: string;                 // pk_tev_<ulid>
  object: "trigger_event";
  type: TriggerType;
  source: string;             // trigger id that fired
  created_at: number;         // Unix ms
  payload: O;                 // raw trigger payload (before Source processes it)
}

export type TriggerType =
  | "cron"
  | "webhook"
  | "event"
  | "manual"
  | "mcp";

/** Option B: Trigger is a distinct meta-layer type above Source */
export interface Trigger<O> {
  type: "trigger";
  id: string;
  triggerType: TriggerType;
  /**
   * Produces a TriggerEvent when the trigger fires.
   * The pipeline's Source then extracts Atom<O>[] from the event.
   */
  fire(context?: TriggerFireContext): Promise<Result<TriggerEvent<O>, TriggerError>>;
}

export interface TriggerFireContext {
  /** Idempotency key for the trigger invocation */
  idempotencyKey?: string;
  /** Caller identity (for manual / MCP triggers) */
  caller?: string;
}

export interface TriggerError {
  type: "trigger_error";
  code:
    | "trigger_misconfigured"
    | "trigger_auth_failed"
    | "trigger_rate_limited"
    | "trigger_timeout";
  message: string;
}

// ---------------------------------------------------------------------------
// Option C: Trigger is config, not a type at all
//
// Inngest: { event: "name" } or { cron: "0 * * * *" }
// GH Actions: `on: { schedule, push, workflow_dispatch }` (YAML)
// n8n: trigger = special node (ITriggerFunctions interface)
// Zapier: trigger = distinct Zap component
//
// In Option C, there is no Trigger<O> type in kit — only adapter config shapes.
// ---------------------------------------------------------------------------

/** Option C: Trigger = adapter config. Kit has no type for this. */

/** Inngest function trigger config shape (mirrors Inngest v4 API) */
export interface InngestTriggerConfig {
  /** Event-based trigger */
  event?: string;
  /** Cron-based trigger */
  cron?: string;
}

/** Generic adapter-level trigger config */
export interface AdapterTriggerConfig {
  runtime: "inngest" | "gh-actions" | "temporal" | "n8n" | "zapier";
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Concrete trigger config shapes (Option C materialisation)
// ---------------------------------------------------------------------------

export interface CronTrigger {
  kind: "cron";
  expression: string;         // e.g. "0 * * * *"
  timezone?: string;          // e.g. "UTC"
}

export interface WebhookTrigger {
  kind: "webhook";
  path: string;               // e.g. "/hooks/pipeline/:id"
  method: "POST" | "PUT";
  secret?: string;            // HMAC-SHA256 secret for verification
}

export interface EventTrigger {
  kind: "event";
  eventName: string;          // e.g. "pipeline/atom.processed"
  filter?: Record<string, unknown>;
}

export interface ManualTrigger {
  kind: "manual";
  allowedCallers?: string[];  // restrict to specific caller IDs
}

export interface McpTrigger {
  kind: "mcp";
  toolName: string;           // MCP tool name that fires this trigger
  serverId?: string;          // optional: restrict to specific MCP server
}

export type TriggerConfig =
  | CronTrigger
  | WebhookTrigger
  | EventTrigger
  | ManualTrigger
  | McpTrigger;

// ---------------------------------------------------------------------------
// Minimal kit trigger event envelope (for CloudEvents probe)
// ---------------------------------------------------------------------------

/**
 * Minimal kit envelope — the smallest shape that unifies all 5 trigger types.
 * Compare against full CloudEvents spec in probe-cloudevents.ts.
 */
export interface KitTriggerEnvelope<T> {
  id: string;             // pk_tev_<ulid>
  type: TriggerType;      // "cron" | "webhook" | "event" | "manual" | "mcp"
  source: string;         // trigger id or URI
  time: string;           // ISO 8601
  data: T;                // trigger-specific payload
}

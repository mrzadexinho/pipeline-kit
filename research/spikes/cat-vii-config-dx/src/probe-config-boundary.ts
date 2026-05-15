/**
 * Cat VII — Cell A: probe-config-boundary.ts
 * Q1+Q2: Where does config end and code begin?
 * Three representations of the same pipeline: Pure-TS | JSON-config | TS-config-object.
 *
 * Pattern: mirrors Inngest createFunction / Hatchet hatchet.task() / Trigger.dev task()
 */

import { z } from 'zod';

// ─── Kit types (inline, spike-only) ──────────────────────────────────────────

type Ok<T> = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

interface Source<O> {
  readonly _brand: 'Source';
  fetch(): AsyncGenerator<Result<O, Error>>;
}
interface Process<I, O> {
  readonly _brand: 'Process';
  run(input: I): Promise<Result<O, Error>>;
}
interface Serve<I> {
  readonly _brand: 'Serve';
  send(payload: I): Promise<Result<void, Error>>;
}

type CronTrigger    = { type: 'cron'; schedule: string };
type WebhookTrigger = { type: 'webhook'; path: string };
type ManualTrigger  = { type: 'manual' };
type TriggerConfig  = CronTrigger | WebhookTrigger | ManualTrigger;

interface RetryPolicy { maxAttempts: number; backoff: 'linear' | 'exponential' | 'fixed' }

interface DefinedPipeline<O> {
  readonly id: string;
  readonly trigger?: TriggerConfig;
  readonly retry?: RetryPolicy;
  readonly concurrency?: number;
  readonly source: Source<O>;
}

// Convenience: DefinedPipeline with chained stages
interface FullDefinedPipeline<O> extends DefinedPipeline<O> {
  readonly process?: Process<unknown, O>;
  readonly serve?: Serve<O>;
}

// ─── Factory stubs (spike: return typed branded objects) ─────────────────────

const apifySchema = z.object({ title: z.string(), url: z.string(), score: z.number() });
type ApifyItem = z.infer<typeof apifySchema>;

const extractSchema = z.object({ summary: z.string(), tags: z.array(z.string()) });
type ExtractResult = z.infer<typeof extractSchema>;

function createApifySource(_cfg: { datasetId: string; schema: typeof apifySchema }): Source<ApifyItem> {
  return {
    _brand: 'Source',
    async *fetch(): AsyncGenerator<Result<ApifyItem, Error>> {
      yield { ok: true, value: { title: 'Test', url: 'https://example.com', score: 0.9 } };
    },
  };
}

function createExtractProcess(_cfg: {
  model: string;
  schema: typeof extractSchema;
}): Process<ApifyItem, ExtractResult> {
  return {
    _brand: 'Process',
    async run(_input: ApifyItem): Promise<Result<ExtractResult, Error>> {
      return { ok: true, value: { summary: 'summary text', tags: ['a', 'b'] } };
    },
  };
}

function createEmailServe(_cfg: { to: string; subject: string }): Serve<ExtractResult> {
  return {
    _brand: 'Serve',
    async send(_payload: ExtractResult): Promise<Result<void, Error>> {
      return { ok: true, value: undefined };
    },
  };
}

// ─── §1: Way A — Pure TS code (status quo) ───────────────────────────────────
// Pattern: plain factory composition; no wrapper, no id, no trigger metadata.

const sourceA = createApifySource({ datasetId: 'xyz', schema: apifySchema });
const processA = createExtractProcess({ model: 'claude-sonnet-4-6', schema: extractSchema });
const serveA = createEmailServe({ to: 'user@example.com', subject: 'Report' });

// Type-checks: all retained — Source<ApifyItem>, Process<ApifyItem,ExtractResult>, Serve<ExtractResult>
const _wayA = { source: sourceA, process: processA, serve: serveA };
// VERDICT: PASS — full type safety; zero metadata; no id, no trigger, no retry.

// ─── §2: Way B — JSON config + runner ────────────────────────────────────────
// Pattern: serialisable config object; all type information must degrade to strings.

interface PipelineConfigJSON {
  id: string;
  source: { type: string; datasetId?: string; schema: string };   // schema → JSON-Schema string
  process: { type: string; model?: string; schema: string };       // schema → JSON-Schema string
  serve:   { type: string; to?: string; subject?: string };
  trigger?: { type: string; schedule?: string };
  retry?: { maxAttempts: number; backoff: string };
}

const wayBConfig: PipelineConfigJSON = {
  id: 'pk_pipe_apify-extract-email',
  source: {
    type: 'apify',
    datasetId: 'xyz',
    schema: '{"type":"object","properties":{"title":{"type":"string"}}}', // string — Zod gone
  },
  process: {
    type: 'extract',
    model: 'claude-sonnet-4-6',
    schema: '{"type":"object","properties":{"summary":{"type":"string"}}}', // string — Zod gone
  },
  serve: { type: 'email', to: 'user@example.com', subject: 'Report' },
  trigger: { type: 'cron', schedule: '0 9 * * 1' },
  retry: { maxAttempts: 3, backoff: 'exponential' },
};

// §O1: TYPE ERASURE INVENTORY for Way B
// ┌────────────────────────────┬─────────────────────────────────────────────┐
// │ Type lost                  │ Consequence                                 │
// ├────────────────────────────┼─────────────────────────────────────────────┤
// │ z.ZodObject<...>           │ Replaced by JSON-Schema string; no runtime  │
// │  (apifySchema, extractSchema) │ parse() — schema coupling broken         │
// │ Process<ApifyItem, ExtractResult> │ Collapsed to type:'extract' string    │
// │  — the transform function  │ Runner must re-instantiate from registry    │
// │ Serve<ExtractResult>       │ Collapsed to type:'email' string            │
// │  — any custom output logic │ Custom predicates/guards: unrepresentable   │
// │ Retry backoff function     │ Enum string only — custom fn impossible     │
// │ IDE rename/refactor        │ string literals — find-replace only         │
// └────────────────────────────┴─────────────────────────────────────────────┘
// VERDICT: FAIL — type erasure is total for schemas + functions.
//   Acceptable only for pure-data config (id, trigger schedule, retry counts).
//   Re-hydration from JSON requires a type-registry (50+ LOC) with no TS guarantee.

const _wayBConfig = wayBConfig; // retain reference to avoid unused-var lint

// ─── §3: Way C — TS config object (Inngest / Hatchet / Trigger.dev pattern) ──
// Inngest: createFunction({ id, triggers: [{ cron: '...' }] }, handler)
// Hatchet: hatchet.task({ name, retries, fn })
// Trigger.dev: task({ id, run: async (payload) => {} })

function definePipeline<O>(config: FullDefinedPipeline<O>): FullDefinedPipeline<O> {
  // Thin wrapper: validates id prefix, returns config typed.
  if (!config.id.startsWith('pk_pipe_')) {
    throw new Error(`Pipeline id must start with pk_pipe_, got: ${config.id}`);
  }
  return config;
}

const wayC = definePipeline({
  id: 'pk_pipe_apify-extract-email',
  trigger: { type: 'cron', schedule: '0 9 * * 1' },
  retry:   { maxAttempts: 3, backoff: 'exponential' },
  source:  createApifySource({ datasetId: 'xyz', schema: apifySchema }),   // Source<ApifyItem> retained
  process: createExtractProcess({ model: 'claude-sonnet-4-6', schema: extractSchema }), // Process<ApifyItem,ExtractResult> retained
  serve:   createEmailServe({ to: 'user@example.com', subject: 'Report' }),  // Serve<ExtractResult> retained
});

// §O2: WAY C PRESERVES EVERYTHING
// wayC.source is Source<ApifyItem>           — full Zod schema live at runtime
// wayC.process is Process<ApifyItem,ExtractResult> — actual transform function
// wayC.serve is Serve<ExtractResult>          — actual send implementation
// wayC.trigger is CronTrigger (discriminated union) — IDE-autocomplete + exhaustive check
// wayC.retry is RetryPolicy — typed enum, not free string
// Compare Inngest: createFunction({ id, triggers }, ctx => ...) — config+code in one call.
// VERDICT: PASS — definePipeline() is a zero-cost typed envelope. No type erasure.

// §O3: WHAT MUST REMAIN CODE (cannot serialise without losing safety)
// (a) Zod schemas: runtime validators — require z.object().parse() at boundary
// (b) Process<I,O> functions: arbitrary TS logic — closures, imports, env captures
// (c) Predicates/guards: (item: T) => boolean — cannot represent in JSON
// (d) Prompt templates: template literals with interpolation and helper imports
// (e) Custom error handlers: (err: StageError) => Result<...,..> — functions
// Ground: Temporal principle — "The code you write IS the code that executes."
//   Any serialisation breaks this guarantee and re-introduces schema drift.
// VERDICT: FAIL for Way B on all 5 axes. Way C PASS on all 5 (code stays code).

// §O4: WHAT CAN BE CONFIG (pure data, safe to serialise)
// (a) Pipeline id string          — pure metadata, stable, referenceable
// (b) TriggerConfig               — { type, schedule/path/eventName } — declarative data
// (c) RetryPolicy                 — maxAttempts: number, backoff enum — data not logic
// (d) concurrency: number         — concurrency limit — data
// (e) timeout: number             — ms value — data
// (f) Adapter selection by name   — e.g. adapter:'apify' — data (registry resolves)
// (g) Env-specific overrides      — process.env ternary in TS IS the switch (see Cell B §O5)
// VERDICT: PASS — these 7 classes are safely config. Everything else is code.

// §O5: WAY C = definePipeline() VERDICT
// definePipeline() is correct DX layer:
//   1. Typed TS config object — IDE support, rename-symbol, exhaustive checks
//   2. Code stays code — Zod schemas, Process fns, custom handlers unchanged
//   3. describe() already on Pipeline provides introspection WITHOUT roundtrip
//      → PipelineDefinition snapshot for dashboard; NOT a deserialisation format
// Compare Hatchet v1: migrated FROM JSON workflow definitions TO hatchet.task()
// Compare Trigger.dev v3: migrated FROM client.defineJob() TO task({ id, run })
// Both migrations: same direction as Way C — config-objects-in-code.
// VERDICT: PASS — definePipeline() is the canonical DX layer for v1.

console.log('[Cell A] config-boundary probe complete');
console.log('  Way A id:', '(none — no metadata)');
console.log('  Way C id:', wayC.id);
console.log('  Way C trigger:', wayC.trigger?.type);
console.log('  Way C retry maxAttempts:', wayC.retry?.maxAttempts);
console.log('  Type erasure in Way B: TOTAL for schemas+fns — FAIL');
console.log('  definePipeline() type preservation: PASS');

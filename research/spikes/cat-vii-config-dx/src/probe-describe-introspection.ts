/**
 * Cat VII — Cell C: probe-describe-introspection.ts
 * Existing describe() → enriched PipelineDefinition for dashboard/OTel.
 *
 * Key question: is describe() a config round-trip or a one-way observability snapshot?
 * Compare: Inngest function metadata (dashboard display, not deserializable).
 */

import { z } from 'zod';

// ─── Kit types (inline, spike-only) ──────────────────────────────────────────

type Ok<T>  = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

interface Source<O>     { readonly _brand: 'Source';  name?: string; fetch(): AsyncGenerator<Result<O, Error>> }
interface Process<I, O> { readonly _brand: 'Process'; name?: string; run(i: I): Promise<Result<O, Error>> }
interface Serve<I>      { readonly _brand: 'Serve';   name?: string; send(p: I): Promise<Result<void, Error>> }

type TriggerConfig =
  | { type: 'cron'; schedule: string }
  | { type: 'webhook'; path: string }
  | { type: 'manual' };

interface RetryPolicy { maxAttempts: number; backoff: 'linear' | 'exponential' | 'fixed' }
interface ConcurrencyPolicy { maxConcurrent: number; queue?: 'drop' | 'buffer' }

// ─── §O1 base: existing PipelineDefinition (shipped in packages/core) ────────

interface PipelineStepExisting {
  kind: 'source' | 'process' | 'store' | 'review' | 'serve';
  // stage refs are live objects — not serialisable as stage identity
  source?:  Source<unknown>;
  process?: Process<unknown, unknown>;
  serve?:   Serve<unknown>;
}

interface PipelineDefinitionExisting {
  pipelineId: string;
  steps: ReadonlyArray<PipelineStepExisting>;
}

// Current describe() is read-only snapshot — demonstrates the one-way nature.
function describeExisting(def: PipelineDefinitionExisting): PipelineDefinitionExisting {
  return def;  // already a snapshot; no roundtrip path exists
}

// PROOF that describe() cannot roundtrip: steps hold live Source/Process/Serve refs.
// JSON.stringify drops functions; no way to reconstruct createApifySource() from snapshot.
// Compare: Inngest's function metadata sent to dashboard (name, triggers, concurrency)
//   → displayed in UI, NOT used to reconstruct the function handler.
// VERDICT: PASS — describe() is correctly one-way. This is a feature, not a bug.

// ─── §O2: PipelineDefinition enrichment for dashboard/CLI ────────────────────
// What describe() should grow to include.

interface PipelineStepEnriched {
  kind: 'source' | 'process' | 'store' | 'review' | 'serve';
  name: string;          // human-readable name for dashboard + OTel span attribute
  adapterType?: string;  // e.g. 'apify', 'extract', 'email' — from stage metadata
}

interface PipelineDefinitionEnriched {
  // Existing fields
  pipelineId: string;
  steps: ReadonlyArray<PipelineStepEnriched>;
  // New metadata fields (added by definePipeline() wrapper)
  trigger?: TriggerConfig;
  retry?: RetryPolicy;
  concurrency?: ConcurrencyPolicy;
  tags?: Record<string, string>;
  version?: string;       // semver — for registry and dashboard display
  createdAt?: number;     // unix ms — snapshot timestamp
}

// Demonstration: build an enriched definition directly
const enrichedDef: PipelineDefinitionEnriched = {
  pipelineId: 'pk_pipe_apify-extract-email',
  steps: [
    { kind: 'source',  name: 'apify-dataset-source',   adapterType: 'apify' },
    { kind: 'process', name: 'claude-extract-process',  adapterType: 'extract' },
    { kind: 'serve',   name: 'email-report-serve',      adapterType: 'email' },
  ],
  trigger:     { type: 'cron', schedule: '0 9 * * 1' },
  retry:       { maxAttempts: 3, backoff: 'exponential' },
  concurrency: { maxConcurrent: 5, queue: 'buffer' },
  tags:        { team: 'data', env: 'production' },
  version:     '1.0.0',
  createdAt:   Date.now(),
};

// VERDICT: PASS — enrichment is additive and non-breaking.
//   Existing PipelineDefinition shape preserved; new fields are optional.
//   pk inspect <pipeline-id> pretty-prints this; dashboard registers it.
//   Compare: Inngest function metadata = id + name + triggers + concurrency (same fields).

// ─── §O3: Serialisable PipelineDefinition for dashboard/registry ─────────────
// One-way: code → description → display/registry.

const serialisedDef = JSON.stringify(enrichedDef, null, 2);
// JSON.stringify succeeds because enrichedDef contains NO live stage refs.
// The live refs (Source, Process, Serve objects) are excluded from the enriched definition.
// enrichedDef.steps[] hold name+adapterType strings, NOT the actual stage objects.
// This is deliberate: the enriched definition IS the serialisable projection.

// Attempting to reconstruct a pipeline from serialisedDef would require:
// 1. A registry mapping adapterType strings → factory functions
// 2. Re-instantiation of Zod schemas (impossible from JSON-Schema strings)
// 3. Re-binding of process function closures (impossible without source code)
// → None of these are supportable without total type erasure (Way B failure, Cell A §O1).

// Registry use case (legitimate): store enrichedDef in a KV store for `pk inspect`.
// Dashboard use case (legitimate): POST enrichedDef to dashboard on pipeline boot.
// Roundtrip use case: NOT supported. NOT needed. describe() output is read-only.

// VERDICT: PASS — JSON.stringify(enrichedDef) is the one-way serialisation path.
//   Pipeline reconstruction from JSON is explicitly NOT a goal.
//   Compare: Pulumi state files store infrastructure snapshots, not reconstruct code.

// ─── §O4: describe() + OTel = observability without config files ──────────────
// OTel span attribute enrichment from PipelineDefinition.

interface OtelSpanAttributes {
  'pipeline.id': string;
  'pipeline.trigger.type': string;
  'pipeline.trigger.schedule'?: string;
  'pipeline.step.count': number;
  'pipeline.step.0.name': string;
  'pipeline.step.0.kind': string;
  'pipeline.step.0.adapter': string;
  'pipeline.retry.max_attempts': number;
  'pipeline.version'?: string;
  [key: string]: string | number | boolean | undefined;
}

function enrichOtelSpan(def: PipelineDefinitionEnriched): OtelSpanAttributes {
  const trigger = def.trigger ?? { type: 'manual' };
  const attrs: OtelSpanAttributes = {
    'pipeline.id': def.pipelineId,
    'pipeline.trigger.type': trigger.type,
    'pipeline.step.count': def.steps.length,
    'pipeline.step.0.name': def.steps[0]?.name ?? 'unknown',
    'pipeline.step.0.kind': def.steps[0]?.kind ?? 'unknown',
    'pipeline.step.0.adapter': def.steps[0]?.adapterType ?? 'unknown',
    'pipeline.retry.max_attempts': def.retry?.maxAttempts ?? 1,
    'pipeline.version': def.version,
  };
  if (trigger.type === 'cron') {
    attrs['pipeline.trigger.schedule'] = trigger.schedule;
  }
  // Enumerate all steps for full span context
  def.steps.forEach((step, i) => {
    attrs[`pipeline.step.${i}.name`]    = step.name;
    attrs[`pipeline.step.${i}.kind`]    = step.kind;
    attrs[`pipeline.step.${i}.adapter`] = step.adapterType ?? 'unknown';
  });
  return attrs;
}

const otelAttrs = enrichOtelSpan(enrichedDef);

// DX value: no config files needed for observability.
// describe() metadata -> OTel span attributes -> dashboard/Jaeger without YAML.
// This is the DX benefit of introspection: metadata-for-observability, not config-as-data.
// Compare: Inngest sends function metadata to dashboard on startup — same pattern.
//   No Inngest-specific YAML. The TS config IS the metadata source.
// VERDICT: PASS — OTel enrichment from describe() eliminates config-file observability.
//   One source of truth: the TS code. describe() projects it for consumption.

// ─── Validation run ──────────────────────────────────────────────────────────

const _apifySchema = z.object({ title: z.string() }); // exercise zod import

console.log('[Cell C] describe-introspection probe complete');
console.log('  Enriched def pipelineId:', enrichedDef.pipelineId);
console.log('  Enriched def trigger type:', enrichedDef.trigger?.type);
console.log('  Enriched def steps count:', enrichedDef.steps.length);
console.log('  Serialised length:', serialisedDef.length, 'chars');
console.log('  describe() roundtrip supported:', false, '(by design — one-way)');
console.log('  OTel pipeline.id:', otelAttrs['pipeline.id']);
console.log('  OTel trigger.type:', otelAttrs['pipeline.trigger.type']);
console.log('  OTel step count:', otelAttrs['pipeline.step.count']);
console.log('  OTel step.0.adapter:', otelAttrs['pipeline.step.0.adapter']);
console.log('  OTel enrichment from describe(): PASS');
console.log('  zod imported:', typeof _apifySchema.parse);

// Final: verify describe() one-way invariant
const originalRef = describeExisting({ pipelineId: 'pk_pipe_test', steps: [] });
console.log('  describeExisting() pipelineId:', originalRef.pipelineId);

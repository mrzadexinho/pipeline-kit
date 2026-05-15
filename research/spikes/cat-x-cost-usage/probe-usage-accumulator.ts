/**
 * Cat X Spike — Cell A: Usage Accumulator Placement
 * Q1: Where does usage data live? ctx.usage vs ctx.deps.meter
 *
 * Ground: Vercel AI SDK usage object, OTel GenAI Semantic Conventions (CNCF),
 *         Langfuse granular usage types.
 */
export {};

// ─── Inline Kit Types ────────────────────────────────────────────────────────

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Accumulates raw metrics per run. No cost derivation — that is adapter-tier. */
interface UsageAccumulator {
  record(metric: string, value: number): void;
  get(metric: string): number;
  getAll(): ReadonlyMap<string, number>;
}

function makeUsageAccumulator(): UsageAccumulator {
  const map = new Map<string, number>();
  return {
    record(metric, value) {
      map.set(metric, (map.get(metric) ?? 0) + value);
    },
    get(metric) {
      return map.get(metric) ?? 0;
    },
    getAll() {
      return map as ReadonlyMap<string, number>;
    },
  };
}

/** Option A: usage lives on PipelineContext (cross-cutting concern). */
interface PipelineContextA {
  runId: string;
  signal: AbortSignal;
  attempt: number;
  trace: { traceId: string; spanId: string };
  usage: UsageAccumulator;                // ← placement under test
  deps: Record<string, unknown>;
}

/** Option B: MeterAdapter lives in deps (service-shaped). */
interface MeterAdapter {
  record(metric: string, value: number, labels?: Record<string, string>): void;
  query(metric: string): number;
}

interface PipelineContextB {
  runId: string;
  signal: AbortSignal;
  attempt: number;
  trace: { traceId: string; spanId: string };
  deps: { meter: MeterAdapter; [key: string]: unknown };
}

// ─── §1: Option A (ctx.usage) placement ──────────────────────────────────────

function makeContextA(runId: string): PipelineContextA {
  return {
    runId,
    signal: new AbortController().signal,
    attempt: 1,
    trace: { traceId: "t-001", spanId: "s-001" },
    usage: makeUsageAccumulator(),
    deps: {},
  };
}

// Simulated Process stage using Option A
function processWithContextA(
  ctx: PipelineContextA,
  input: string
): Result<string, string> {
  // OTel GenAI convention keys — adapter naming standard
  ctx.usage.record("gen_ai.usage.input_tokens", input.length * 4);
  ctx.usage.record("gen_ai.usage.output_tokens", 150);
  return { ok: true, value: `processed: ${input}` };
}

// §1 test
const ctxA = makeContextA("pk_run_001");
processWithContextA(ctxA, "hello world");
// VERDICT: PASS — usage sits alongside signal and trace; all cross-cutting.
// ctx.usage.get("gen_ai.usage.input_tokens") === 44 (11 chars × 4)
// ctx.usage.get("gen_ai.usage.output_tokens") === 150
console.assert(ctxA.usage.get("gen_ai.usage.input_tokens") === 44);
console.assert(ctxA.usage.get("gen_ai.usage.output_tokens") === 150);

// ─── §2: Option B (ctx.deps.meter) placement ─────────────────────────────────

function makeMeterAdapter(): MeterAdapter {
  const store = new Map<string, number>();
  return {
    record(metric, value, _labels?) {
      store.set(metric, (store.get(metric) ?? 0) + value);
    },
    query(metric) {
      return store.get(metric) ?? 0;
    },
  };
}

function makeContextB(runId: string): PipelineContextB {
  return {
    runId,
    signal: new AbortController().signal,
    attempt: 1,
    trace: { traceId: "t-002", spanId: "s-002" },
    deps: { meter: makeMeterAdapter() },
  };
}

function processWithContextB(
  ctx: PipelineContextB,
  input: string
): Result<string, string> {
  ctx.deps.meter.record("gen_ai.usage.input_tokens", input.length * 4);
  ctx.deps.meter.record("gen_ai.usage.output_tokens", 150);
  return { ok: true, value: `processed: ${input}` };
}

// §2 test
const ctxB = makeContextB("pk_run_002");
processWithContextB(ctxB, "hello world");
// VERDICT: FAIL — MeterAdapter is service-shaped; Composer cannot read total
// without knowing the deps key. Inconsistent with signal/trace placement.
// deps.meter is not accessible to Composer without coupling to key name.
console.assert(ctxB.deps.meter.query("gen_ai.usage.input_tokens") === 44);

// ─── §3: Generic metric keys, NOT kit-defined taxonomy ───────────────────────

// OTel GenAI Semantic Conventions (experimental, CNCF-backed) provide naming.
// Kit-core is metric-name-agnostic. Adapters pick keys.
const usageGeneric = makeUsageAccumulator();
usageGeneric.record("gen_ai.usage.input_tokens", 1500);  // OTel standard
usageGeneric.record("gen_ai.usage.output_tokens", 300);  // OTel standard
usageGeneric.record("api.requests", 1);                  // custom
usageGeneric.record("data.bytes", 204800);               // custom (Apify)
// VERDICT: PASS — Map<string, number> is generic enough for all naming schemes.

// ─── §4: Per-atom accumulation, per-run aggregation ─────────────────────────

const atom1Usage = makeUsageAccumulator();
const atom2Usage = makeUsageAccumulator();
atom1Usage.record("gen_ai.usage.input_tokens", 500);
atom2Usage.record("gen_ai.usage.input_tokens", 300);

// Composer aggregates: run.usage = sum(atom.usage for all atoms)
const runUsage = makeUsageAccumulator();
for (const [metric, value] of atom1Usage.getAll()) runUsage.record(metric, value);
for (const [metric, value] of atom2Usage.getAll()) runUsage.record(metric, value);

// VERDICT: PASS — aggregation is pure Map arithmetic.
// Matches Langfuse model: generation traces roll up to session-level cost.
console.assert(runUsage.get("gen_ai.usage.input_tokens") === 800);

// ─── §5: Cost derivation is adapter-tier, NOT kit-core ───────────────────────

// Kit sees cost.usd IF adapter chose to record it — never computes it.
// Anthropic Sonnet 3.5: $3/MTok input. Adapter computes; kit just accumulates.
function anthropicCostAdapter(inputTokens: number, outputTokens: number): number {
  const INPUT_COST_PER_MTOK = 3.0;   // USD, Sonnet 3.5 (2024-26 pricing)
  const OUTPUT_COST_PER_MTOK = 15.0; // USD
  return (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK
       + (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;
}

const ctx5 = makeContextA("pk_run_005");
ctx5.usage.record("gen_ai.usage.input_tokens", 10_000);
ctx5.usage.record("gen_ai.usage.output_tokens", 2_000);
// Adapter computes, records cost.usd:
const costUsd = anthropicCostAdapter(
  ctx5.usage.get("gen_ai.usage.input_tokens"),
  ctx5.usage.get("gen_ai.usage.output_tokens")
);
ctx5.usage.record("cost.usd", costUsd);

// VERDICT: PASS — kit-core sees cost.usd as any other metric. Pricing table
// is @idriszade/cost pack territory. Langfuse has built-in pricing tables;
// OTel has no cost attributes (token counts only). Same split confirmed.
console.assert(Math.abs(ctx5.usage.get("cost.usd") - 0.06) < 0.001);

// ─── §O5: LOC check — UsageAccumulator implementation ────────────────────────
// Implementation above: ~12 lines for makeUsageAccumulator(). Well under 30.
// VERDICT: PASS — trivial Map<string, number> wrapper; thread-safe in single-
// threaded JS by construction (no shared mutable state across async gaps).

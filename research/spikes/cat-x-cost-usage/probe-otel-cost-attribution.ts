/**
 * Cat X Spike — Cell C: OTel Cost Attribution
 * Q3: OTel mapping   Q4: Fan-out attribution
 *
 * Ground: OTel GenAI Semantic Conventions (experimental, CNCF), Langfuse
 *         session/generation model, Cat IV kitFanOut (ADR-IV-6).
 */
export {};

// ─── Inline Kit Types ────────────────────────────────────────────────────────

interface UsageAccumulator {
  record(metric: string, value: number): void;
  get(metric: string): number;
  getAll(): ReadonlyMap<string, number>;
}

function makeUsageAccumulator(): UsageAccumulator {
  const map = new Map<string, number>();
  return {
    record(m, v) { map.set(m, (map.get(m) ?? 0) + v); },
    get(m) { return map.get(m) ?? 0; },
    getAll() { return map as ReadonlyMap<string, number>; },
  };
}

// ─── §1: ctx.usage → OTel span attributes mapping ───────────────────────────

/** Minimal OTel Span mock (no SDK dep). */
interface MockSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attrs?: Record<string, string | number>): void;
}

function makeMockSpan(name: string): MockSpan {
  const attributes: Record<string, string | number | boolean> = {};
  return {
    name,
    attributes,
    setAttribute(key, value) { attributes[key] = value; },
    addEvent(_name, _attrs?) { /* no-op in mock */ },
  };
}

/**
 * @idriszade/observe pack — maps ctx.usage → OTel span attributes.
 * OTel GenAI conventions are the naming standard; direct 1:1 mapping.
 * No transformation needed when kit uses OTel GenAI keys natively.
 */
function enrichCostSpan(span: MockSpan, usage: UsageAccumulator): void {
  for (const [metric, value] of usage.getAll()) {
    span.setAttribute(metric, value);  // e.g., gen_ai.usage.input_tokens = 1500
  }
}

// §1 probe
const runUsage = makeUsageAccumulator();
runUsage.record("gen_ai.usage.input_tokens", 1500);
runUsage.record("gen_ai.usage.output_tokens", 300);
runUsage.record("gen_ai.request.model", 0);  // would be string in real OTel

const runSpan = makeMockSpan("pipeline pk_run_001");
enrichCostSpan(runSpan, runUsage);

// VERDICT: PASS — direct attribute mapping; OTel span receives all kit metrics.
// @idriszade/observe pack handles this; kit-core has no OTel dependency.
console.assert(runSpan.attributes["gen_ai.usage.input_tokens"] === 1500);
console.assert(runSpan.attributes["gen_ai.usage.output_tokens"] === 300);

// ─── §2: Fan-out cost attribution — parent = sum of children ────────────────

/**
 * kitFanOut([child1, child2, child3]) — Cat IV ADR-IV-6.
 * Each child has its own ctx.usage. Parent sums all children.
 * OTel: parent span gets total; child spans get individual.
 * Standard OTel parent/child span composition.
 */

interface FanOutChild {
  id: string;
  usage: UsageAccumulator;
  span: MockSpan;
}

function runFanOut(children: FanOutChild[]): {
  parentUsage: UsageAccumulator;
  parentSpan: MockSpan;
} {
  const parentUsage = makeUsageAccumulator();
  const parentSpan = makeMockSpan("kitFanOut pk_run_002");

  for (const child of children) {
    // Each child enriches its own span
    enrichCostSpan(child.span, child.usage);
    // Parent accumulates sum of children
    for (const [metric, value] of child.usage.getAll()) {
      parentUsage.record(metric, value);
    }
  }
  // Parent span gets total
  enrichCostSpan(parentSpan, parentUsage);
  return { parentUsage, parentSpan };
}

// §2 probe: child1=500, child2=300, child3=700 → parent=1500
const children: FanOutChild[] = [
  { id: "child-1", usage: makeUsageAccumulator(), span: makeMockSpan("child-1") },
  { id: "child-2", usage: makeUsageAccumulator(), span: makeMockSpan("child-2") },
  { id: "child-3", usage: makeUsageAccumulator(), span: makeMockSpan("child-3") },
];
children[0]!.usage.record("gen_ai.usage.input_tokens", 500);
children[1]!.usage.record("gen_ai.usage.input_tokens", 300);
children[2]!.usage.record("gen_ai.usage.input_tokens", 700);

const { parentUsage, parentSpan } = runFanOut(children);

// VERDICT: PASS — parent.usage = 1500; child spans retain individual counts.
console.assert(parentUsage.get("gen_ai.usage.input_tokens") === 1500);
console.assert(parentSpan.attributes["gen_ai.usage.input_tokens"] === 1500);
console.assert(children[0]!.span.attributes["gen_ai.usage.input_tokens"] === 500);
console.assert(children[1]!.span.attributes["gen_ai.usage.input_tokens"] === 300);
console.assert(children[2]!.span.attributes["gen_ai.usage.input_tokens"] === 700);

// ─── §3: Langfuse integration point = observe pack adapter ──────────────────

/**
 * Langfuse trace = kit run. Langfuse generation = kit Process stage.
 * Langfuse usage: { input, output, total } maps directly from ctx.usage.
 * The @idriszade/observe Langfuse adapter does this mapping. NOT kit-core.
 * Self-hostable; already running on agent-forge VPS at :3000.
 */

interface LangfuseGenerationUsage {
  input: number;
  output: number;
  total: number;
  unit: "TOKENS" | "CHARACTERS" | "MILLISECONDS" | "SECONDS" | "IMAGES";
}

function toLangfuseUsage(usage: UsageAccumulator): LangfuseGenerationUsage {
  const input = usage.get("gen_ai.usage.input_tokens");
  const output = usage.get("gen_ai.usage.output_tokens");
  return { input, output, total: input + output, unit: "TOKENS" };
}

const stageUsage = makeUsageAccumulator();
stageUsage.record("gen_ai.usage.input_tokens", 2000);
stageUsage.record("gen_ai.usage.output_tokens", 400);
const langfusePayload = toLangfuseUsage(stageUsage);

// VERDICT: PASS — trivial adapter in @idriszade/observe; no kit-core change needed.
console.assert(langfusePayload.input === 2000);
console.assert(langfusePayload.total === 2400);
console.assert(langfusePayload.unit === "TOKENS");

// ─── §4: Cost dashboard via describe() + usage ──────────────────────────────

/**
 * pipeline.describe() (Cat VII ADR-VII-5) + ctx.usage from completed runs
 * = dashboard data. No separate cost reporting system needed.
 * pk inspect → topology; pk trace → cost per run via OTel.
 */

interface PipelineDescriptor {
  id: string;
  name: string;
  stages: Array<{ id: string; type: "source" | "process" | "serve" | "store" }>;
}

interface RunSummary {
  runId: string;
  pipelineId: string;
  usage: ReadonlyMap<string, number>;
  completedAt: Date;
}

function buildCostDashboard(
  descriptor: PipelineDescriptor,
  runs: RunSummary[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const run of runs) {
    for (const [metric, value] of run.usage) {
      totals[metric] = (totals[metric] ?? 0) + value;
    }
  }
  return { pipelineStageCount: descriptor.stages.length, ...totals };
}

const descriptor: PipelineDescriptor = {
  id: "pk_pipe_001",
  name: "content-pipeline",
  stages: [
    { id: "src", type: "source" },
    { id: "proc", type: "process" },
    { id: "srv", type: "serve" },
  ],
};

const run1Usage = makeUsageAccumulator();
run1Usage.record("gen_ai.usage.input_tokens", 5000);
run1Usage.record("cost.usd", 0.03);

const run2Usage = makeUsageAccumulator();
run2Usage.record("gen_ai.usage.input_tokens", 7000);
run2Usage.record("cost.usd", 0.042);

const dashboard = buildCostDashboard(descriptor, [
  { runId: "r1", pipelineId: "pk_pipe_001", usage: run1Usage.getAll(), completedAt: new Date() },
  { runId: "r2", pipelineId: "pk_pipe_001", usage: run2Usage.getAll(), completedAt: new Date() },
]);
// VERDICT: PASS — describe() topology + accumulated run usage covers dashboard needs.
console.assert(dashboard["gen_ai.usage.input_tokens"]! === 12000);
console.assert(Math.abs(dashboard["cost.usd"]! - 0.072) < 0.001);

// ─── §5: Ollama (local AI) cost surface ─────────────────────────────────────

/**
 * Local models: NO USD token cost. Cost surface = compute-time + energy.
 * Same UsageAccumulator; different metric keys.
 * OTel has NO Ollama-specific conventions yet — kit's generic accumulator
 * handles this naturally without any kit-core change.
 */

const ollamaUsage = makeUsageAccumulator();
ollamaUsage.record("compute.duration_ms", 1200);
ollamaUsage.record("compute.gpu_seconds", 3.5);
// Token counts still relevant for local models (context window management):
ollamaUsage.record("gen_ai.usage.input_tokens", 800);
ollamaUsage.record("gen_ai.usage.output_tokens", 200);
// NOTE: cost.usd deliberately NOT recorded for local models — no pricing table.

// VERDICT: PASS — kit-core is metric-name-agnostic. Local AI adapters emit
// compute.duration_ms / compute.gpu_seconds. CostBudget can guard on any key:
// { metric: 'compute.duration_ms', limit: 5000, action: 'warn' }
console.assert(ollamaUsage.get("compute.duration_ms") === 1200);
console.assert(ollamaUsage.get("cost.usd") === 0);  // not recorded → 0

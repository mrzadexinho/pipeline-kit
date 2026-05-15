# Cat X Spike — Cost, Usage & Rate Budgets

> Spike: cost-metering-and-budget
> Commit: [leave blank — brain fills post-merge]
> Cells: 3 (A: usage-accumulator, B: cost-budget-guard, C: otel-cost-attribution)
> Friction anchor: F-COST (catalog #8; 3/9 projects)

## Headline verdict

`ctx.usage: UsageAccumulator` (generic `Map<string, number>`) belongs on
PipelineContext alongside `signal` and `trace` — same cross-cutting rationale.
`CostBudget` declaration (`action: abort | review | warn`) follows RunGuard
pattern; `runtime_budget_exceeded` (19th StageErrorCode, `retryable: false`) is
the only taxonomy change. OTel GenAI Semantic Conventions provide the key
namespace; cost derivation is adapter-tier only.

## Cell A findings (usage-accumulator)

### O1 — ctx.usage is the right placement
Usage is cross-cutting like `signal` (AbortSignal) and `trace` — belongs on
PipelineContext, not deps. `ctx.deps.meter` (Option B) is service-shaped: Composer
cannot read the total without coupling to the dep key name. Vercel AI SDK returns
usage alongside result as part of call context, not a separate service.
VERDICT: PASS.

### O2 — Generic metric keys, NOT kit taxonomy
UsageAccumulator is `Map<string, number>`. Metric names come from adapters following
OTel GenAI Semantic Conventions: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`.
Custom keys (`api.requests`, `data.bytes`) also valid. Kit-core is name-agnostic.
VERDICT: PASS.

### O3 — Per-atom accumulation, per-run aggregation
Each Process call records to own `ctx.usage`. Composer aggregates: `runUsage = sum(atom.usage)`.
Verified: atom1(500) + atom2(300) → runUsage === 800. Matches Langfuse generation→session rollup.
VERDICT: PASS.

### O4 — Cost derivation is adapter-tier
Tokens → USD requires model pricing tables (Anthropic Sonnet: $3/MTok input).
That is `@idriszade/cost` pack territory. OTel has no cost attributes (token counts only).
Langfuse has built-in model pricing tables; kit delegates the same way.
VERDICT: PASS.

### O5 — UsageAccumulator is ~12 LOC
`Map<string, number>` with `record()` (additive), `get()`, `getAll()` (immutable snapshot).
Thread-safe by single-threaded JS construction.
VERDICT: PASS.

### Unexpected friction
None.

## Cell B findings (cost-budget-guard)

### O1 — CostBudget as declaration shape (RunGuard pattern)
`interface CostBudget { metric, limit, action: 'abort'|'review'|'warn' }`.
Composer checks `ctx.usage.get(budget.metric) >= budget.limit` between stages.
Action gradient mirrors Stripe billing thresholds (alert at 80% → cap at 100%).
VERDICT: PASS.

### O2 — runtime_budget_exceeded: 18→19 StageErrorCode
Runtime category, `retryable: false`. Spending more tokens will not fix a budget
overrun — Stripe terminates rather than retries. Only taxonomy change Cat X requires.
VERDICT: PASS.

### O3 — CostBudget + Reviewable<I> composition
`action: 'review'` routes to HRP Reviewable<I> with budget-context payload.
Human approves → continue; human rejects → `runtime_budget_exceeded`. NOT a new
primitive — standard Reviewable with budget-driven trigger. Verified: $4.50 < $5.00 → pass;
$5.10 >= $5.00 → abort.
VERDICT: PASS.

### O4 — Budget on pipeline.run() options
`pipeline.run(input, { costBudget: CostBudget[] })`. Array of independent budgets;
Composer checks all between every stage transition. Mirrors Stripe multi-meter support.
Matches packs outline §4.2 (`costCap: { usd: 5 }` shape).
VERDICT: PASS.

### O5 — Rate limiting is adapter-tier only
Rate limiting (req/s) ≠ budget (total spend). Inngest `rateLimit` on functions;
kit delegates via RunGuard declaration (Cat IV ADR-IV-5). No kit-core rate limiter.
VERDICT: PASS.

### Unexpected friction
None. RunGuard pattern lifts cleanly to cost budgets.

## Cell C findings (otel-cost-attribution)

### O1 — ctx.usage → OTel span attributes: direct 1:1 mapping
`enrichCostSpan(span, usage)` iterates `getAll()` and calls `setAttribute(metric, value)`.
No transformation needed because kit uses OTel GenAI convention keys natively.
`@idriszade/observe` pack handles this; zero OTel dep in kit-core.
VERDICT: PASS.

### O2 — Fan-out cost attribution: parent = sum of children
`kitFanOut([c1, c2, c3])`: each child has own `ctx.usage`. Parent sums all children.
Verified: c1(500) + c2(300) + c3(700) = parent(1500). Standard OTel parent/child span
composition.
VERDICT: PASS.

### O3 — Langfuse integration = observe pack adapter
Langfuse `usage: { input, output, total, unit }` maps trivially from `ctx.usage`.
Verified: input=2000, output=400 → total=2400. NOT kit-core.
VERDICT: PASS.

### O4 — Cost dashboard via describe() + usage
`pipeline.describe()` topology (Cat VII ADR-VII-5) + accumulated `ctx.usage` from
completed runs = dashboard data. `pk trace` exposes OTel spans with cost attributes.
No separate cost reporting system needed.
VERDICT: PASS.

### O5 — Ollama (local AI) cost surface
Local models: `compute.duration_ms` + `compute.gpu_seconds`. Same accumulator; different
keys. `CostBudget { metric: 'compute.duration_ms', limit: 5000, action: 'warn' }` works
unchanged. Kit-core doesn't care whether the metric is tokens or GPU seconds.
VERDICT: PASS.

### Unexpected friction
None. OTel key reuse is seamless.

## Carry-forwards

1. **cf-X-1** — `@idriszade/cost` pack spec: model pricing table API
   `(model, inputTok, outputTok) → USD`. Out of kit-core scope.
2. **cf-X-2** — Langfuse `cached_tokens`: `gen_ai.usage.cached_tokens` key
   compatible with UsageAccumulator. No code change; document in ADRs.
3. **cf-X-3** — `ctx.usage` snapshot on StageError: attach usage snapshot
   to `runtime_budget_exceeded` error payload for diagnostics. Lift to M1.
4. **cf-X-4** — Budget persistence across retries: `ctx.usage` resets per
   attempt. Cross-attempt budget tracking → M1 Inngest-adapter scope.

## ADR direction signal

- **X-1:** UsageAccumulator on PipelineContext; `Map<string, number>`; OTel GenAI key namespace.
- **X-2:** `runtime_budget_exceeded` added to StageErrorCode; Runtime category; `retryable: false`.
- **X-3:** CostBudget declaration; RunGuard pattern; action gradient; `pipeline.run()` options.
- **X-4:** Cost derivation is adapter-tier (`@idriszade/cost` pack); kit-core accumulates raw only.
- **X-5:** Rate limiting is adapter-tier only; no kit-core rate limiter.

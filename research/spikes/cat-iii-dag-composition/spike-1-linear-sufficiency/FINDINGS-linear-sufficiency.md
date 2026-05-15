# Spike #1 — linear-sufficiency FINDINGS

> Spike: probe whether the current linear Composer + adapter-tier patterns are
> sufficient to express real-world DAG-shaped workflows, using agent-forge's
> 8-step Studio lifecycle as the highest-signal F-LINEAR case.
> Directory: `research/spikes/cat-iii-dag-composition/spike-1-linear-sufficiency/`
> Branch: master. Author: Executor — 2026-05-14.
> Friction anchor: F-LINEAR (friction catalog top-15 #11).

---

## §1. SETUP

**Approach:** type-level probes only. No Inngest, no external deps, no runtime.
Inline kit types defined in `src/kit-types.ts` (mirrors packages/core/src exactly).
All probes confirmed clean: `tsc --noEmit` exits 0, strict mode, no `any`.

**Files:**
- `src/kit-types.ts` — inline Process/Source/Serve/Pipeline/Result stubs
- `src/probe-a-linear-baseline.ts` — steps 1-7 as single Composer chain
- `src/probe-b-parallel-terminal.ts` — step 8 parallel terminal branches
- `src/probe-c-gate-integration.ts` — demand-gate as isolated Process<I,I>
- `src/probe-d-hypothetical-merge.ts` — fan-out -> merge -> continue
- `src/probe-e-back-edge-loop.ts` — validate loops back to execute

**Run command:**
```bash
cd research/spikes/cat-iii-dag-composition/spike-1-linear-sufficiency
npx tsc --noEmit   # exits 0 — all probes clean
```

---

## §2. OBSERVATIONS

### O1 — Linear chain: generic threading is intact

**CONFIRMED (tsc --noEmit exits 0):**

7-step sequential chain compiles without errors. Each `.through()` call
constrains the next step's input type at compile time.

```ts
Pipeline
  .from(researchSource)            // Source<ResearchOutput>
  .through(demandGateProcess)      // Process<ResearchOutput, DemandSignal>
  .through(planProcess)            // Process<DemandSignal, Plan>
  .through(executeProcess)         // Process<Plan, ExecutionResult>
  .through(validateProcess)        // Process<ExecutionResult, ValidationReport>
  .through(deployProcess)          // Process<ValidationReport, DeploymentRecord>
  .to(battleTestServe)             // Serve<DeploymentRecord>
// -> TerminalPipeline<DeploymentRecord>  <- typed correctly
```

Generic flow is a compile-time guarantee. No runtime type assertion needed.

---

### O2 — Gate pattern: invisible to the type chain

**CONFIRMED (probe-c, tsc --noEmit exits 0):**

A gate (Process<I,I>) slots into `.through()` without changing the
SourcePipeline's type parameter. The chain after the gate continues with
the same O as before it.

```ts
Pipeline.from(researchSource)       // SourcePipeline<ResearchOutput>
  .through(demandGate)              // Process<ResearchOutput, ResearchOutput>
                                    // -> SourcePipeline<ResearchOutput>  <- same O
  .through(demandEnrichProcess)     // Process<ResearchOutput, DemandSignal>
                                    // -> SourcePipeline<DemandSignal>
```

Gate errors propagate as ProcessError with code `gate_held` or `gate_rejected`
— same mechanism as any Process error. No new error type, no new API surface.
Downstream steps are unreachable when gate returns err() — standard Composer
short-circuit, not gate-specific behavior.

---

### O3 — Parallel terminal branches: Promise.all tuple inference works

**CONFIRMED (probe-b, tsc --noEmit exits 0):**

Two heterogeneous terminal branches express correctly as factory pipelines +
Promise.all:

```ts
const [marketingResult, consolidateResult] = await Promise.all([
  makeMarketingPipeline(battleResult).run(),    // Result<RunResult<MarketingCampaign>, RunError>
  makeConsolidatePipeline(battleResult).run(),  // Result<RunResult<ConsolidationRecord>, RunError>
]);
// Inferred tuple: [Result<RunResult<MarketingCampaign>, RunError>,
//                  Result<RunResult<ConsolidationRecord>, RunError>]
// No `as` cast required. Heterogeneous types preserved.
```

Type narrowing (`error !== null`) works independently on each branch.

The fan-out point is NOT in the Composer API — it lives in imperative
`Promise.all` code outside any Pipeline instance. Each branch requires its own
Source factory because `TerminalPipeline.run(input?)` accepts `unknown`.

---

### O4 — run(input?) type erasure: structural gap

**CONFIRMED by signature inspection:**

`TerminalPipeline.run(input?: unknown)` erases the type of the input value.
To pass a typed domain value to a branch pipeline, callers must use either:
1. Factory Source (probe-b pattern) — TYPE SAFE, requires per-run construction.
2. `.run(input)` with Source that reads from `Record<string, unknown>` query
   — type unsafe, requires manual cast inside the Source.

Option 1 is the correct pattern. Ergonomic cost: one factory function per
branch type. Acceptable at N=2 branches.

---

### O5 — Fan-out -> merge: NOT expressible in a single chain

**CONFIRMED (probe-d, tsc --noEmit exits 0):**

Merge requires three phases:
1. Both branches run in parallel (Promise.all)
2. Imperative assembly: collect outputs, check errors, construct tuple
3. Third pipeline: Source<tuple> + Process<tuple, Summary> + Serve

**Structural gap D1-A:** The Serve<O> terminal "swallows" typed Process output.
If a branch ends with `Serve<MarketingCampaign>`, `pipeline.run()` returns
`RunResult<MarketingCampaign>` (correct) — but using Serve as a merge-point
collector is semantically wrong. Serve is for side-effecting emission, not
inter-pipeline data collection. Merge-targeted branches need a passthrough Serve.

**Hypothetical primitive** (NOT implemented):
```ts
Pipeline.merge([pipelineA, pipelineB], mergeProcess).to(summaryServe)
// -> TerminalPipeline<Summary>
```
Requires: new static method + `BranchOutputs<Branches>` type utility +
new PipelineStep variant + Composer runtime changes. 3 new API surfaces.
NOT justified by agent-forge lifecycle (no merge required there).

---

### O6 — Back-edge/loop: not expressible in Composer

**CONFIRMED (probe-e, E3 section):**

`SourcePipeline<O>` has no `.loopBack()` or `.cycle()`. `PipelineDefinition.steps`
is `ReadonlyArray<PipelineStep>` — flat list, no back-pointer.

**Workaround (split-pipeline):** split at the back-edge into two pipelines;
drive loop in application code. This works but requires a passthrough Serve at
the split point to expose the intermediate typed value.

**Alternative:** Inngest `kitStep()` retry policy is the natural loop primitive
for validate->execute loops — express the condition as a step-level retry, not
a Composer back-edge. Avoids any new kit-core primitive.

---

### O7 — OTel span hierarchy in DAG (structural assessment)

**STRUCTURAL PREDICTION:**

Parallel branches produce sibling spans, not nested spans:
```
parent_pipeline_run
  step_1 ... step_7   (linear children)
branch_A_pipeline_run  <- sibling of parent, not child
  marketing_process
branch_B_pipeline_run  <- sibling
  consolidate_process
```

Parent-child OTel relationship is lost at the fan-out point. `RunOptions` has
no `parentTraceContext?: TraceContext` field. Adding one would fix this.
Low-cost addition; no behavioral change for existing callers.

---

## §3. FIVE-QUESTION MATRIX

**Q1 — Graph topology declaration**

No declarative topology API. "A -> B+C (parallel) -> D" requires 3 pipeline
definitions + 2 Promise.all calls + 1 Source factory per branch. Graph lives
in application glue code. Ergonomic for N=2 terminal branches; grows linearly
with branch count and merge requirements.

**Q2 — Type safety through branching/merging**

Branching: FULL. Promise.all tuple inference preserves heterogeneous branch
types without casts (O3). Merging: type-safe at each phase but requires
imperative assembly at the merge point. Passthrough Serve workaround needed
for merge-targeted branches (O5/D1-A).

**Q3 — Backward compat**

`.from().through().to()` unchanged. Steps 1-7 linear: zero gaps (O1). Step 8
parallel terminal: expressible via Promise.all outside the chain (O3). Gate:
no change (O2). New API needed only for declarative merge or loop primitive —
neither required by agent-forge v1 scope.

**Q4 — Loops/cycles**

Not supported in Composer (O6/E3). Workaround: split pipeline at back-edge +
application-level loop. For validate->execute retry: Inngest kitStep() retry
policy is the natural substitute. No new kit-core primitive needed for the
common pattern.

**Q5 — OTel span hierarchy in DAG**

Parallel branches produce sibling spans (O7). Fix: `RunOptions.parentTraceContext`
field addition (carry-forward cf #1). Small change, no breaking impact.

---

## §4. CARRY-FORWARDS

**cf #1** — `RunOptions.parentTraceContext?: TraceContext`: add field so branch
pipelines can inherit parent run's OTel span. Fixes O7. Low-cost, non-breaking.

**cf #2** — Passthrough Serve pattern: merge-targeted branches and loop split-
points need a `passthroughServe<O>(): Serve<O>` that emits a no-op and returns
input unchanged. Brain: core utility or docs-only pattern?

**cf #3** — `run(input?)` type erasure: factory-Source pattern is the current
answer. Brain: assess whether a typed `run<Q>(query: Q)` overload is worth
adding, or confirm factory-Source as the canonical pattern.

**cf #4** — Fan-out -> merge: 3 new API surfaces. Not justified by current
reference projects. Brain: confirm non-goal for v1; document threshold for
adding (e.g., 2+ reference projects requiring merge within 6 months).

**cf #5** — Loop primitive: Inngest kitStep() retry handles validate->execute.
Brain: confirm non-goal for Composer back-edge; document in spec as explicit
decision.

---

## §5. VERDICT

**Current patterns sufficient for v1. No new kit-core primitive needed.**

The agent-forge 8-step Studio lifecycle is fully expressible:
- Steps 1-7 linear chain: zero gaps (O1)
- Gate Process<I,I> at step 2: zero gaps, no new API (O2)
- Parallel terminal branches at step 8 via Promise.all + factory Source:
  type-safe, ergonomic, ~20 LOC boilerplate (O3)
- Validate->execute loop: Inngest kitStep() retry covers the common case (O6)

Single minor gap: OTel trace context not propagated to branch pipelines (O7).
Fix is a one-field `RunOptions` addition (cf #1) — not a new primitive.

Fan-out->merge and Composer back-edges are structural gaps but are NOT required
by the agent-forge lifecycle. Both are carry-forwarded as explicit non-goals.

*Author: Executor — 2026-05-14. Branch: master (agent-ab6f59dd0f02fc1e2 worktree).*
*Strict TS; no external deps; `tsc --noEmit` exits 0 across all 5 probe files.*

# pipeline-kit — v1 Cat III Research Notes: DAG Composition & Graph Model

> Phase 1 v1 synthesis. Author: Brain — 2026-05-14.
> Inputs: 1 spike FINDINGS file (`research/spikes/cat-iii-dag-composition/spike-1-linear-sufficiency/`).
> Friction anchor: F-LINEAR (friction catalog top-15 #11; 2/9 projects).
> Status: synthesis complete; 2 ADR candidates locked direction; 5 carry-forwards resolved.

---

## Sources reviewed

### Spike evidence (this kit, 1 throwaway spike — empirical truth)

- Spike #1 (`855f067`, 2026-05-14) — `linear-sufficiency`. 7 observations. Type-level probes only;
  5 probe files, all `tsc --noEmit` exits 0. Agent-forge 8-step Studio lifecycle as
  highest-signal F-LINEAR case. Steps 1-7 linear chain confirmed zero gaps (O1). Gate
  Process<I,I> invisible to chain (O2). Parallel terminal branches via `Promise.all` +
  factory Source: tuple inference works, no casts (O3). `run(input?)` type erasure surfaces
  factory-Source as canonical typed-input pattern (O4). Fan-out → merge requires 3 pipeline
  phases + imperative assembly — NOT expressible in single chain (O5). Back-edge/loop not
  expressible in Composer; kitStep() retry is the natural substitute (O6). OTel sibling
  span gap at fan-out; `RunOptions.parentTraceContext` field would fix (O7).

### External sources (modern industry standards 2024-26)

- **LangGraph** — StateGraph with nodes, conditional edges, cycles. Declarative DAG-native.
  Supports back-edges and merge natively. Kit deliberately does not follow this model —
  different target (autonomous agent graphs vs typed automation stages).
- **Prefect 3.0** — Python `.submit()` / `.result()` DAG. Heavy graph machinery; declarative
  topology declaration. Served as evidence that declarative graph adds significant API surface
  for teams that only need linear chains.
- **Temporal** — workflow-as-code (imperative, not declarative DAG). `workflow.executeChild()`
  for parallel dispatch. Kit's Inngest integration follows this imperative model — closest
  industry alignment.
- **Apache Beam** — PCollection / PTransform composition. DAG-native transform graph;
  data-centric, not stage-centric. Paradigm mismatch with kit's stage model.
- **Dagster** — asset-based DAG. Data-centric rather than stage-centric. Paradigm mismatch.
- **Effect.ts** — `Effect.all` / `.race` / `.fork`. Imperative composition. Closest to kit's
  composition model after Temporal; `Effect.all` structural parallel to kit's `Promise.all`
  fan-out pattern.
- **n8n** — visual node graph → JSON schema. Visual builder paradigm kit does not share;
  cited as evidence for the declarative-vs-imperative split.

---

## Reframe note

The v1 research outline framed Cat III as five questions: (1) TS DAG representation,
(2) `Fan<I,Branches>` primitive viability, (3) OTel in a DAG, (4) retry in a DAG,
(5) backward compatibility. The outline anticipated multiple spikes.

By the time Cat III was reached, Cats I, IV, and VI had substantially pre-answered four of
the five questions:

- ADR-IV-1 rejected `Fan<I,Branches>` as a kit primitive; ADR-IV-7 established `kitFanOut()`
  in the adapter layer.
- ADR-VI-1 established gate as `Process<I,I>` (invisible to the chain); ADR-VI-2 established
  aggregate as `Process<I[],O>` with buffer.
- ADR-I-2 established `kitStep()` retry as the natural substitute for validate→execute loops,
  making the "retry in a DAG" question moot for the common case.
- Backward compatibility (Q3 in outline) was never in question: the `.from().through().to()`
  chain API is unchanged.

The remaining open question was whether these primitives *compose* to express the
agent-forge 8-step lifecycle without new kit-core surfaces — i.e., a sufficiency test rather
than the originally envisioned multi-spike exploration. One spike proved sufficient to answer it.

---

## ADR candidates

### ADR-v1-III-1 — Linear API + adapter-tier patterns sufficient for v1; graph model deferred to v2

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** F-LINEAR is the friction anchor (catalog top-15 #11; 2/9 reference projects
surface it). The core question: does kit need a graph model — declarative topology
declaration, merge primitive, or back-edge support — to express the DAG-shaped workloads
present in reference projects? The highest-signal case is agent-forge's 8-step Studio
lifecycle, which includes a gate at step 2 and heterogeneous parallel terminal branches at
step 8. ADR-IV-1 already rejected `Fan<I,Branches>`. This ADR consolidates the sufficiency
verdict and documents explicit non-goals.

**Decision:** Linear API + adapter-tier patterns are sufficient for v1. No new kit-core
primitive is required. Specifically:

1. *Steps 1-7 linear chain* — zero gaps. Generic type threading via `.through()` is a
   compile-time guarantee; each step constrains the next input type (O1).
2. *Gate at step 2* — `Process<I,I>` slots into `.through()` unchanged; chain type parameter
   is unaffected; gate errors propagate as standard ProcessError (O2, ADR-VI-1).
3. *Parallel terminal branches at step 8* — `Promise.all` + factory Source is the canonical
   pattern. Tuple type inference preserves heterogeneous branch types without casts (~20 LOC;
   O3). `run(input?)` type erasure means factory-Source (one factory function per branch type)
   is the correct pattern for typed branch inputs; a typed `run<Q>()` overload is not needed
   (O4).
4. *Fan-out → merge* — expressible via 3 pipeline executions + imperative assembly, but NOT
   a v1 goal. Zero of 9 reference projects require merge. Explicit non-goal. Threshold for
   adding: 2+ reference projects requiring merge within 12 months.
5. *Back-edge/loop* — not expressible in Composer. `kitStep()` retry (ADR-I-2) is the natural
   substitute for validate→execute loops. Explicit non-goal for v1; split-pipeline + passthrough
   Serve is the documented workaround for cases where the kitStep() substitute is insufficient
   (O6).

**Alternatives considered:**

- *Graph model (declarative topology, `Pipeline.merge()`, back-edges).* Rejected — adds 3+
  new API surfaces for patterns not required by any current reference project. LangGraph and
  Beam demonstrate the complexity graph-native models introduce; kit's personal-toolkit scale
  does not justify it.
- *`Fan<I,Branches>` as Tier-2 primitive.* Already rejected by ADR-IV-1. Confirmed here:
  spike #1 O3 shows `Promise.all` + factory Source achieves the same result type-safely
  without a new primitive.
- *Typed `run<Q>(query: Q)` overload.* Rejected — factory-Source is the canonical answer to
  the `run(input?)` type erasure gap (O4). An overload would require Composer changes for
  minimal ergonomic gain at N=2 branches.

**Reference:** Spike #1 O1 (linear chain intact), O2 (gate invisible to chain), O3
(Promise.all tuple inference), O4 (factory-Source canonical), O5 (merge = 3 pipelines +
glue; not a v1 goal), O6 (no back-edge; kitStep() retry substitute).

**Consequences:**

- No new kit-core primitive. `Fan<I,Branches>` rejected (confirmed with ADR-IV-1). Graph
  model deferred to v2, triggered by 2+ reference projects needing merge or declarative
  topology within 12 months of v1 ship.
- Passthrough Serve (`passthroughServe<O>(): Serve<O>`) is a documented pattern — not a new
  utility shipped in kit-core. Relevant for: merge-targeted branches that need intermediate
  output accessible across pipeline boundaries, and loop split-points. Docs-only.
- Factory-Source pattern is the canonical way to pass typed domain values into branch
  pipelines. Adapter-inngest docs must show this pattern alongside `kitFanOut()`.
- Resolves: Cat III Q1 (TS DAG representation = imperative; no declarative topology), Q2
  (`Fan<I,Branches>` rejected; factory-Source canonical), Q3 (backward compat: unchanged),
  Q4 (loop = explicit non-goal; kitStep() covers common case).

---

### ADR-v1-III-2 — RunOptions.parentTraceContext for OTel span hierarchy across fan-out

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** When parallel branch pipelines are dispatched via `Promise.all`, each branch
creates an independent OTel trace. The parent pipeline's trace context is not propagated —
branches produce sibling spans, not child spans, breaking the expected parent-child hierarchy
at fan-out points. The structural prediction from spike #1 O7 shows:

```
parent_pipeline_run
  step_1 ... step_7   (linear children — correct)
branch_A_pipeline_run  <- sibling of parent, not child
  marketing_process
branch_B_pipeline_run  <- sibling
  consolidate_process
```

Without parent-child linkage, distributed tracing across fan-out is diagnostic-blind — the
most valuable OTel use case (tracing a multi-branch execution as a single trace) is absent.

**Decision:** Add `RunOptions.parentTraceContext?: TraceContext` (optional field). Branch
pipelines pass the parent run's trace context; the OTel SDK uses it to establish parent-child
span relationships. Non-breaking — existing callers unaffected. `adapter-inngest`'s
`kitFanOut()` helper should populate this field automatically from the parent step's context,
so callers get correct span hierarchy without manual wiring.

**Alternatives considered:**

- *Implicit propagation via AsyncLocalStorage.* Rejected — kit is a library, not a framework.
  Assuming ALS availability across all runtimes (Cloudflare Workers, Bun, etc.) is unsafe.
  Explicit opt-in via `RunOptions` is the correct seam.
- *No propagation (status quo).* Rejected — fan-out without trace linkage defeats OTel's
  primary diagnostic value for multi-branch pipelines. Low-cost fix with high observability
  payoff; deferral not justified.

**Reference:** Spike #1 O7 (sibling spans; parent trace context lost at fan-out).

**Consequences:**

- One-field addition to `RunOptions` interface in `@idriszade/core`. No behavioral change
  for linear pipelines or callers that omit the field.
- `kitFanOut()` in `@idriszade/adapter-inngest` should extract the parent step's OTel context
  and populate `parentTraceContext` on each child `RunOptions` automatically. Adapter docs
  must note this.
- Resolves: Cat III Q5 (OTel in DAG); spike #1 cf #1.

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)

- **spike #1 cf #1** (`RunOptions.parentTraceContext`) → RESOLVED by ADR-v1-III-2
- **spike #1 cf #2** (passthrough Serve pattern) → RESOLVED by ADR-v1-III-1 (docs-only pattern; not a new kit-core utility)
- **spike #1 cf #3** (`run<Q>()` typed overload vs factory-Source) → RESOLVED by ADR-v1-III-1 (factory-Source confirmed canonical; no overload)
- **spike #1 cf #4** (fan-out → merge: API surface assessment) → RESOLVED by ADR-v1-III-1 (explicit non-goal for v1; threshold = 2+ reference projects within 12 months)
- **spike #1 cf #5** (loop primitive vs Composer back-edge) → RESOLVED by ADR-v1-III-1 (back-edge explicit non-goal; kitStep() retry covers common case per ADR-I-2)

### Lifted to future milestones or categories

None. Cat III is self-contained. All 5 spike carry-forwards resolved by this synthesis.

---

*End of v1 Cat III research notes. 2 ADR candidates locked direction; 5 carry-forwards resolved (all by ADRs; none lifted). Reframe: outline's 5 questions substantially pre-answered by Cats I, IV, and VI; single spike reduced to a composition sufficiency test. Verdict: linear API + adapter-tier patterns sufficient for v1; graph model deferred to v2. `RunOptions.parentTraceContext` is the one load-bearing addition. No new kit-core primitive.*

*Author: Brain — 2026-05-14. Input: spike #1 (`855f067`). Branch: `master`. Master tip at synthesis: `855f067`.*

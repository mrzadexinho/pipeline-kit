# pipeline-kit — v1 Cat VII Research Notes: Configuration, Templates & Developer Experience

> Phase 1 v1 synthesis. Author: Brain — 2026-05-14.
> Inputs: 1 spike FINDINGS file (`research/spikes/cat-vii-config-dx/`).
> Friction anchor: F-CONFIG (catalog top-15 #6; 4/9 projects).
> Status: synthesis complete; 5 ADR candidates locked direction; 4 carry-forwards dispositioned.

---

## Sources reviewed

### Spike evidence (1 spike)

- **config-boundary-and-dx** — commit `86feed3`; 3 cells (A: config-boundary, B: cli-and-templates,
  C: describe-introspection); 14 observations; headline: code-first wins at every axis, no
  serialisable pipeline format warranted.

### External sources (industry grounding)

- **Inngest v4** — `createFunction({ id, triggers }, handler)`: config object wraps code; no YAML.
  Metadata sent to dashboard on startup (one-way); handler never reconstructed from it.
- **Temporal TS SDK** — "The code you write IS the code that executes." Workflows are plain TS
  functions; no serialisable workflow spec.
- **Trigger.dev v3/v4** — `task({ id, run })` factory; migrated away from `client.defineJob()`;
  `@trigger.dev/cli` npm package follows same TS-runtime distribution model.
- **Hatchet v1** — `hatchet.task()` factory; changelog explicitly cites migration from JSON
  workflow definitions to factory calls as "more ergonomic."
- **Pulumi** — Won over Terraform HCL for TS shops: real TS conditionals eliminate weak
  templating. Component model = factory function, not JSON template file.

---

## Reframe note

The v1 outline framed Cat VII around whether to adopt a JSON/YAML pipeline config format and how
to make it serialisable. The spike showed this framing was the wrong question. The real question
is WHERE the config/code boundary falls — which concerns are safely declarative data versus which
must remain live TS code. Once that boundary is resolved (see table below), the conclusion
follows automatically: `definePipeline()` wraps the existing `Pipeline.from().through().to()`
chain with a typed metadata envelope; no serialisable pipeline format is needed or defensible.

---

## Spike — config-boundary-and-dx

### What was built

- **Cell A (config-boundary):** Three Ways compared — Way A (pure code, no wrapper), Way B
  (JSON config expressing full pipeline), Way C (`definePipeline()` typed envelope). Ways A and B
  each had a representative proof-of-concept pipeline wired against a probe dataset.
- **Cell B (cli-and-templates):** Minimum CLI surface scoped to 4 commands; factory-function
  template pattern proved against a representative `createExtractPipeline()` helper; PRP
  placement decided.
- **Cell C (describe-introspection):** `pipeline.describe()` enrichment probed; one-way vs
  roundtrip serialisation decided; OTel span mapping sketched.

### What it revealed

1. **Type erasure in Way B is total (O1-A).** All logic-carrying fields — Zod schemas, Process
   functions, Serve implementations, backoff strategies, rename-symbol IDE tooling — collapse to
   untyped strings in JSON. Reconstruction requires a 50+ LOC registry with no TS guarantees.
2. **Way C (definePipeline) has zero type erasure (O2-A).** It is a thin validated envelope;
   all stage types are preserved because factory functions run at construction time.
3. **Seven concerns are safely declarative config; five must remain code (O3-A, O4-A).** The
   config/code boundary is clean — see normative table below.
4. **Minimum CLI surface is ~150 LOC across 4 commands (O1-B).** Thin wrapper over
   `pipeline.run()`, `pipeline.describe()`, and the OTLP endpoint. No bespoke framework needed.
5. **Templates are factory functions, not JSON (O3-B).** `createExtractPipeline({ id, ... })`
   returns a fully typed `DefinedPipeline<T>`. Rename propagation works across all call sites.
6. **PRP maps to Source<PRPContent> with no new stage type (O4-B).** Identical ruling to Cat II
   ADR-II-2: structured external content → Source adapter variant.
7. **describe() is one-way observability projection, not roundtrip (O1-C).** Enriched
   `PipelineDefinitionEnriched` serialises cleanly (700 chars in probe); reconstruction from
   snapshot is explicitly out of scope.

---

## Config/code boundary table (normative)

| Concern | Config (data) | Code (logic) | Rationale |
|---|---|---|---|
| Pipeline identity | id, name, tags | — | Pure metadata, stable string |
| Trigger | type, schedule, event name | — | Declarative data, no logic |
| Retry policy | maxAttempts, backoff enum | Custom backoff fn | Policy=data; strategy=code |
| Concurrency | maxConcurrent, queue mode | Custom queue logic | Limit=data; algorithm=code |
| Timeout | ms integer | — | Pure data |
| Schema validation | — | Zod schemas (live) | Runtime type guard, not serialisable |
| Process logic | — | Process<I,O> function | Arbitrary computation, closures |
| Serve output | — | Serve<I> function | Network I/O + custom auth/headers |
| Error handling | — | Custom error handlers | Functions, not enum-mappable |
| Prompt templates | — | Template literals + helpers | Interpolation = code |
| Env overrides | — | TS ternaries in definePipeline | TS IS the switch |
| Adapter selection | type string (registry maps) | Factory fn (instantiation) | Name=data; impl=code |
| Observability | tags, version, step names | — | Metadata for display |

---

## Modern-direction framing

The 2024-26 industry consensus is unambiguous: orchestration SDKs moved from JSON/YAML workflow
definitions to code-first factory calls. Inngest v4 uses `createFunction({ id, triggers }, handler)`.
Temporal TS SDK ships workflows as plain functions with no serialisable spec. Trigger.dev v3/v4
migrated from `client.defineJob()` to `task({ id, run })`, explicitly abandoning the JSON-config
model; its CLI follows as `@trigger.dev/cli` (npm package, not a standalone binary). Hatchet v1
cites "ergonomics" in its changelog migration note. Pulumi's win over Terraform HCL for TS shops
establishes that real TS conditionals and types are superior to weak config templating.
`definePipeline()` is kit's arrival at the same destination from first principles.

---

## ADR candidates

### ADR-v1-VII-1 — Code-first config: definePipeline() as v1 DX layer; no serialisable pipeline format

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** Spike Cell A proved type erasure in JSON config is total for all logic-carrying
fields. Seven concerns are safely declarative (see normative table above); five must remain live TS.

**Decision:** `definePipeline({ id, trigger?, retry?, concurrency?, tags?, version? }, pipeline)`
is the v1 DX layer. It validates the `pk_pipe_` id prefix and returns the metadata + pipeline
chain as a typed `DefinedPipeline<I,O>`. No YAML/JSON pipeline format is produced or consumed.

**Alternatives considered:** Way B (JSON config) — FAIL: total type erasure, registry overhead.
Way A (bare pipeline, no wrapper) — valid but loses id/trigger metadata for CLI and observability.

**Reference:** Inngest `createFunction()`, Temporal TS SDK principle, Trigger.dev `task()`,
Hatchet `hatchet.task()`. Confirms Cat IV ADR-IV-2 (TriggerConfig at Tier 1) and ADR-IV-4
(RunGuard 5-shape as config).

**Consequences:** Pipelines are TS modules; no pipeline config file format to parse or validate at
the kit layer. CLI discovery relies on a glob convention (cf #1 → resolved by VII-2).

---

### ADR-v1-VII-2 — @idriszade/cli as npm package; 4-command minimum surface

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** Spike Cell B scoped minimum CLI at ~150 LOC: `pk dev`, `pk run`, `pk inspect`,
`pk trace`. Inngest uses a Go binary (wrong language boundary for a TS-runtime kit). Trigger.dev
ships `@trigger.dev/cli` as an npm package — identical language boundary and distribution model.

**Decision:** `@idriszade/cli` is an npm package (`packages/cli`) with `bin: { pk: "dist/cli.js" }`,
depending on `@idriszade/core`. `pk dev` uses glob `pipelines/**/*.pipeline.ts` for file
discovery (resolves cf #1). 4 commands minimum: `dev`, `run <id>`, `inspect <id>`, `trace <run-id>`.

**Alternatives considered:** Standalone binary (Go/Rust) — wrong boundary; TS runtime required to
import user pipeline modules. Single-file CLI in core — breaks package separation.

**Consequences:** CLI ships as separate versioned package. Pipeline file discovery convention
(`*.pipeline.ts`) becomes a project layout norm documented in CLI README.

---

### ADR-v1-VII-3 — Templates = TS factory functions; no JSON/YAML templates

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** Spike Cell B proved `createExtractPipeline({ id, datasetId, model, schema, emailTo,
trigger, retry })` returns fully typed `DefinedPipeline<ExtractResult>` with IDE rename
propagation. No template file is produced.

**Decision:** Pipeline templates are TS factory functions exported from `@idriszade/packs/*`.
No JSON/YAML template files. Env-specific config is TS ternaries inside `definePipeline()`.

**Alternatives considered:** JSON template files — type erasure (same failure as Way B). Mustache/
Handlebars YAML — no type safety, no IDE integration. Pulumi component model (factory fn) — adopted.
Hatchet changelog migration from JSON workflow defs — confirms direction.

**Consequences:** Templates are versioned with the pack they ship in. No template parser needed in
core. Pulumi-style composition: any TS abstraction (loops, conditionals) works natively.

---

### ADR-v1-VII-4 — PRP-as-Source<PRPContent>; no Spec<I> stage type

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** Spike Cell B confirmed PRP content is structured external input emitted once per
run. Adding a `Spec<I>` stage type was considered; it introduces a 5th stage primitive with no
additional capability over `Source<PRPContent>`.

**Decision:** PRP maps to `Source<PRPContent>`. Pipeline shape: `Source<PRPContent> →
Process<PRPContent, AnalysisResult> → Serve<AnalysisResult>`. No `Spec<I>` type added.

**Alternatives considered:** `Spec<I>` as distinct stage — unnecessary; identical runtime
behaviour to Source, adds API surface.

**Reference:** Cat II ADR-II-2 (MCP Prompts = Source variant). Identical ruling; PRP is a
structured external content pattern, not a new stage primitive.

**Consequences:** PRP adapters ship as Source adapters in `@idriszade/packs/prp`. No spec-phase
type changes to the 4-stage model (Source / Process / Store / Serve).

---

### ADR-v1-VII-5 — describe() enriched + one-way; PipelineDefinitionEnriched

**Status:** v1 candidate (synthesis 2026-05-14). Awaiting brain v1 spec lock.

**Context:** Spike Cell C confirmed `pipeline.describe()` serialises cleanly to ~700 chars JSON
with enriched fields. Roundtrip reconstruction from the snapshot was explicitly probed and
rejected — it reintroduces all of Way B's registry/erasure problems.

**Decision:** `PipelineDefinitionEnriched` extends current `PipelineDefinition` with optional
fields: `trigger?`, `retry?`, `concurrency?`, `tags?`, `version?`; each step gains `name?: string`
and `adapterType?: string`. `describe()` is one-way; `JSON.stringify(pipeline.describe())`
is the canonical serialisation path for dashboard/registry. Roundtrip reconstruction is not
supported. `version` source: explicit field in `definePipeline()` opts; fallback to
`package.json` version at kit level (resolves cf #4).

**Alternatives considered:** Roundtrip serialisation — FAIL (see Cell C reasoning and Pulumi
state-file analogy). Keeping current minimal PipelineDefinition — loses dashboard/OTel richness.

**Reference:** Inngest dashboard: function metadata sent on startup, never used to reconstruct
handler. Pulumi state files: one-way infrastructure snapshot, reconstruction from source only.
Cat I ADR-I-2 (kitStep shim) and Cat VI ADR-VI-2 (buffer config) enriched by same describe() path.

**Consequences:** Stage factories must attach optional `name` and `adapterType` to return objects
(cf #2 → lifted to v1 spec, core types section). `enrichOtelSpan(def)` maps enriched definition
to OTel span attributes (~15 LOC); no separate observability config files.

---

## Carry-forwards resolution summary

### Resolved by ADRs (this synthesis)

- **cf #1 — pipeline file discovery convention** → resolved by VII-2. Glob: `pipelines/**/*.pipeline.ts`.
  CLI convention documented in `@idriszade/cli` README.
- **cf #4 — PipelineDefinitionEnriched schema** → resolved by VII-5. Field set locked: trigger,
  retry, concurrency, tags, version (explicit-or-package.json fallback), step name + adapterType.

### Lifted to future milestones

- **cf #2 — stage name + adapterType metadata placement** → lifted to v1 spec (core types
  section). Stage interface vs metadata wrapper decision belongs with type definitions, not DX ADRs.
- **cf #3 — @idriszade/cli package shape (commander vs yargs, bin entry, monorepo placement)**
  → lifted to v1 spec (package section). Implementation detail; 7/10 cat research must complete
  before spec-phase locks package topology.

---

*End of v1 Cat VII research notes. 5 ADRs lock code-first config, CLI, templates, PRP-as-Source,
and describe() enrichment; 2 carry-forwards resolved, 2 lifted to spec phase. Cat X NEXT in
spike order.*

*Author: Brain — 2026-05-14. Inputs: spike `86feed3`. Branch: `master`. Master tip at synthesis: `86feed3`.*

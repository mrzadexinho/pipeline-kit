# Cat VII Spike — Configuration, Templates & Developer Experience

> Spike: config-boundary-and-dx
> Commit: 86feed3
> Cells: 3 (A: config-boundary, B: cli-and-templates, C: describe-introspection)
> Friction anchor: F-CONFIG (catalog #6; 4/9 projects)

## Headline verdict

Code-first wins at every axis: type erasure in JSON/YAML config is total for Zod schemas
and Process functions, while `definePipeline()` wraps the existing `Pipeline.from().through().to()`
chain with typed metadata (id, trigger, retry) at zero cost. The DX layer is `definePipeline()` +
`@idriszade/cli` (~150 LOC); no serialisable pipeline format is needed or defensible.

## Cell A findings (config-boundary)

### O1 — Type erasure in Way B (JSON config)

Five type classes are completely erased when a pipeline is expressed as JSON: (1) Zod schemas
become JSON-Schema strings with no runtime `parse()` coupling; (2) Process functions become
`type: 'extract'` string references requiring a registry to re-instantiate; (3) Serve
implementations collapse to adapter-name strings; (4) custom backoff/retry functions reduce to
enum strings; (5) rename-symbol IDE refactoring degrades to find-and-replace. The runner
needed to re-hydrate this config is 50+ LOC with no TypeScript guarantee on the output type.
VERDICT: FAIL — type erasure is total for all logic-carrying fields.

### O2 — Way C preserves everything

`definePipeline()` is a thin typed envelope: validates the `pk_pipe_` id prefix and returns
the config unchanged. All stage types are preserved — `Source<ApifyItem>`,
`Process<ApifyItem, ExtractResult>`, `Serve<ExtractResult>` — because factory functions run
at construction time and return types are retained. Compare Inngest's `createFunction({ id,
triggers }, handler)` — same pattern: config object wraps code, not replaces it.
VERDICT: PASS — zero type erasure.

### O3 — What MUST remain code

Five classes cannot be serialised without safety loss: (a) Zod schemas — runtime validators;
(b) Process functions — arbitrary TS closures; (c) predicates/guards — functions; (d) prompt
templates — template literals with imports; (e) custom error handlers — functions. Ground:
Temporal's principle — "The code you write IS the code that executes."
VERDICT: FAIL for Way B; PASS for Way C on all 5 axes.

### O4 — What CAN be config (pure data)

Seven classes are safely declarative: pipeline id; TriggerConfig (type + schedule/path);
RetryPolicy (maxAttempts + backoff enum); concurrency limit integer; timeout ms integer;
adapter selection by name string; env-specific overrides as TS ternaries.
VERDICT: PASS — 7 clean config classes.

### O5 — definePipeline() verdict

`definePipeline()` is the correct v1 DX layer. Hatchet v1 and Trigger.dev v3 both migrated from
JSON workflow definitions to `hatchet.task()` / `task({ id, run })` factory calls, citing
ergonomics as the explicit reason. Kit arrives at the same destination from first principles.
VERDICT: PASS — adopt definePipeline() as the v1 API layer.

### Unexpected friction

None. Boundary is clean and matches prior art precisely. Only non-obvious finding: describe()
enrichment (Cell C) requires stage objects to carry optional `name` and `adapterType` metadata.

## Cell B findings (cli-and-templates)

### O1 — Minimum CLI surface

Four commands cover the full operational surface: `pk dev` (~60 LOC), `pk run <pipeline-id>`
(~30 LOC), `pk inspect <pipeline-id>` (~20 LOC), `pk trace <run-id>` (~40 LOC). Total: ~150 LOC.
The CLI is a thin wrapper over `pipeline.run()`, `pipeline.describe()`, and the OTLP endpoint.
Compare: Trigger.dev uses `@trigger.dev/cli` (npm package) for the same TS-runtime pattern.

### O2 — CLI as @idriszade/cli npm package

`@idriszade/cli` should be an npm package with `bin: { pk: "dist/cli.js" }` depending on
`@idriszade/core`. This mirrors `@trigger.dev/cli` exactly — same language boundary (TS
runtime), same distribution model (npm), same monorepo relationship. Inngest's Go binary is
correct for Go infrastructure tooling; not applicable here.

### O3 — Templates = factory functions, NOT JSON

`createExtractPipeline({ id, datasetId, model, schema, emailTo, trigger, retry })` returns a
fully typed `DefinedPipeline<ExtractResult>`. This is Pulumi's component model in TS: a
function encapsulating a common pattern, preserving all types. Rename any field → IDE updates
all call sites automatically. Compare: Hatchet's changelog explicitly cites migration from
JSON workflow definitions to `hatchet.task()` as "more ergonomic."

### O4 — PRP-as-Source, NOT PRP-as-Spec

PRP maps cleanly to `Source<PRPContent>` — one emitted atom per run. Pipeline:
`Source<PRPContent> → Process<PRPContent, AnalysisResult> → Serve<AnalysisResult>`. No new
`Spec<I>` stage type warranted. Identical ruling to Cat II ADR-II-2 (MCP Prompts = Source
variant): structured external content maps to Source adapter.

### O5 — Environment-specific config via definePipeline overrides

`process.env['NODE_ENV'] === 'production' ? {...} : {...}` inside `definePipeline()` is the
idiomatic env-specific config mechanism. No `.env.production.yaml` files. TS ternary IS the
environment switch — both branches type-checked, both rename-safe. Compare: Pulumi won over
Terraform HCL specifically because real conditionals eliminate weak templating.

### Unexpected friction

`pk dev` requires a pipeline file discovery convention (glob pattern). Candidate:
`pipelines/**/*.pipeline.ts`. Minor carry-forward; touches project layout convention (cf #1).

## Cell C findings (describe-introspection)

### O1 — describe() is read-only introspection, NOT roundtrip

Existing `Pipeline.describe()` returns a snapshot with live stage object refs.
`JSON.stringify` drops these; reconstruction from the snapshot requires a type registry
that reintroduces all of Way B's erasure problems. This is a feature: describe() is a
one-way observability projection. Compare: Inngest sends function metadata to dashboard on
startup — displayed in UI, never used to reconstruct the handler.

### O2 — PipelineDefinition enrichment

`PipelineDefinition` should grow from `{ pipelineId, steps[] }` to include: `trigger?`,
`retry?`, `concurrency?`, `tags?`, `version?`, `createdAt?`. Steps should include `name:
string` and `adapterType?: string` for dashboard display and OTel enrichment. All new fields
are optional; existing shape preserved. Carry-forward: stage factories need to attach `name`
and `adapterType` to their return objects (cf #2).

### O3 — Serialisable PipelineDefinition for dashboard/registry

`JSON.stringify(pipeline.describe())` is the correct serialisation path. The enriched
definition (700 chars in probe) serialises cleanly because it contains no live stage refs.
Roundtrip reconstruction is explicitly NOT supported or targeted. Compare: Pulumi state files
are one-way infrastructure snapshots; reconstruction is done from source, not from state.

### O4 — describe() + OTel = observability without config files

`enrichOtelSpan(def)` maps `PipelineDefinitionEnriched` → OTel span attributes in ~15 LOC:
`pipeline.id`, `pipeline.trigger.type`, `pipeline.trigger.schedule`, `pipeline.step.N.name`,
`pipeline.step.N.adapter`, `pipeline.retry.max_attempts`. One canonical source (TS code) →
describe() → OTel spans + dashboard display + pk inspect output. No observability config files.

### Unexpected friction

Stage `name` metadata location needs an ADR: on the stage interface vs a metadata wrapper.
Probe used optional `name?: string` on the stage interface — simplest path but needs decision.

## Config/code boundary summary table

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

## Carry-forwards

1. **cf #1 — pipeline file discovery convention.** `pk dev` needs glob pattern.
   Candidate: `pipelines/**/*.pipeline.ts`. Touches project layout ADR.
2. **cf #2 — stage name + adapterType metadata.** Stage factories need optional `name` and
   `adapterType` on return objects for describe() enrichment and OTel. ADR needed.
3. **cf #3 — @idriszade/cli package shape.** Confirm commander vs yargs; confirm bin entry;
   confirm monorepo placement (packages/cli). ~150 LOC implementation.
4. **cf #4 — PipelineDefinitionEnriched schema.** Lock exact field set in synthesis ADR —
   especially `version` source (package.json vs explicit in definePipeline()).

## ADR direction signal

- **VII-1: code-first config.** `definePipeline()` is the v1 DX layer. No serialisable pipeline
  format. Config/code boundary table above is the normative reference.
- **VII-2: @idriszade/cli as npm package.** ~150 LOC, 4 commands. Follow @trigger.dev/cli
  pattern (not Inngest Go binary).
- **VII-3: templates = factory functions.** `createExtractPipeline()` pattern (Pulumi component
  model). No JSON templates, no YAML template files.
- **VII-4: PRP-as-Source.** PRP maps to `Source<PRPContent>` — no new stage type. Same ruling
  as Cat II ADR-II-2.
- **VII-5: describe() one-way + enriched.** Enrich PipelineDefinition with trigger/retry/
  concurrency/tags/version. One-way serialisation via JSON.stringify for dashboard/registry.

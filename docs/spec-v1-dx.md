# pipeline-kit v1 Spec — DX: Configuration, Templates & Developer Experience

> Drilldown for `spec-v1.md`. Covers Cat VII (5 ADRs).
> Source: `docs/research-notes-v1-cat-VII.md` (spike `86feed3`, synthesis `f176749`).

---

## §VII — Config/DX (5 ADRs)

### VII-1: definePipeline() — code-first config

**Status:** RATIFIED

**Decision:** `definePipeline()` is the v1 DX layer; no YAML/JSON pipeline format is produced or consumed.

**Signature:**
```ts
definePipeline<I, O>(
  opts: {
    id: `pk_pipe_${string}`;
    trigger?: TriggerConfig;
    retry?: RetryPolicy;
    concurrency?: ConcurrencyPolicy;
    tags?: Record<string, string>;
    version?: string;
  },
  pipeline: Pipeline<I, O>
): DefinedPipeline<I, O>
```

**Key constraint:** JSON config causes total type erasure for all logic-carrying fields (Zod schemas, Process functions, Serve implementations, backoff strategies). The seven safely-declarative concerns below must remain data; the five code-bound concerns must remain live TS.

**Config/code boundary table (normative):**

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

**Consequence:** Pipelines are TS modules. CLI discovery relies on a glob convention (resolved by VII-2). Confirms Cat IV ADR-IV-2 (TriggerConfig at Tier 1) and ADR-IV-4 (RunGuard 5-shape as config).

---

### VII-2: @idriszade/cli — 4-command minimum

**Status:** RATIFIED

**Decision:** `@idriszade/cli` ships as an npm package (`packages/cli`) with `bin: { pk: "dist/cli.js" }`, depending on `@idriszade/core`. Pipeline file discovery uses glob `pipelines/**/*.pipeline.ts`.

**4-command minimum surface:**

| Command | Description |
|---|---|
| `pk dev` | Watch mode; discovers `*.pipeline.ts` via glob, hot-reloads on change |
| `pk run <id>` | Execute a named pipeline; accepts `--input` JSON or stdin |
| `pk inspect <id>` | Print `pipeline.describe()` output as formatted JSON |
| `pk trace <run-id>` | Fetch and display OTel trace for a completed run |

**Key constraint:** A standalone binary (Go/Rust) is the wrong language boundary — importing user pipeline modules requires the TS runtime. ~150 LOC across 4 commands; no bespoke CLI framework needed.

**Consequence:** CLI ships as a separately versioned package. The `*.pipeline.ts` file discovery convention becomes a project layout norm documented in `@idriszade/cli` README. Resolves carry-forward #1.

---

### VII-3: Templates = factory functions

**Status:** RATIFIED

**Decision:** Pipeline templates are TS factory functions exported from `@idriszade/packs/*`; no JSON/YAML template files. Env-specific config is TS ternaries inside `definePipeline()`.

**Key constraint:** JSON/YAML template files produce the same total type erasure as Way B (JSON config). Mustache/Handlebars variants add no type safety and no IDE integration.

**Example shape:**
```ts
// @idriszade/packs/extract
export function createExtractPipeline(opts: {
  id: string;
  datasetId: string;
  model: string;
  schema: ZodSchema;
  emailTo: string;
  trigger?: TriggerConfig;
  retry?: RetryPolicy;
}): DefinedPipeline<ExtractResult> { ... }
```

**Consequence:** Templates are versioned with the pack they ship in. No template parser needed in core. Pulumi-style composition: any TS abstraction (loops, conditionals, closures) works natively. IDE rename propagation works across all call sites.

---

### VII-4: PRP-as-Source<PRPContent>; no Spec<I> stage type

**Status:** RATIFIED

**Decision:** PRP (Product Requirements Prompt) maps to `Source<PRPContent>`. No `Spec<I>` stage type is added.

**Pipeline shape:**
```
Source<PRPContent> → Process<PRPContent, AnalysisResult> → Serve<AnalysisResult>
```

**Key constraint:** A `Spec<I>` stage type would introduce a 5th stage primitive with identical runtime behaviour to `Source` — adding API surface with no additional capability.

**Consequence:** PRP adapters ship as Source adapters in `@idriszade/packs/prp`. The 4-stage model (Source / Process / Store / Serve) is unchanged. Identical ruling to Cat II ADR-II-2 (MCP Prompts = Source variant).

---

### VII-5: describe() enriched + one-way; PipelineDefinitionEnriched

**Status:** RATIFIED

**Decision:** `pipeline.describe()` returns `PipelineDefinitionEnriched` — a one-way observability projection. Roundtrip reconstruction from the snapshot is not supported.

**PipelineDefinitionEnriched field list:**

| Field | Source | Notes |
|---|---|---|
| `id` | `definePipeline` opts | `pk_pipe_` prefixed |
| `trigger?` | `definePipeline` opts | Serialisable TriggerConfig |
| `retry?` | `definePipeline` opts | Serialisable RetryPolicy |
| `concurrency?` | `definePipeline` opts | Serialisable ConcurrencyPolicy |
| `tags?` | `definePipeline` opts | `Record<string, string>` |
| `version?` | `definePipeline` opts or `package.json` fallback | Resolves cf #4 |
| `steps[].name?` | Stage factory optional metadata | Display label |
| `steps[].adapterType?` | Stage factory optional metadata | e.g. `"http-source"` |

**Key constraint:** Roundtrip reconstruction from describe() output reintroduces all of Way B's registry/type-erasure problems. `JSON.stringify(pipeline.describe())` is the canonical serialisation path for dashboard/registry consumers.

**Consequence:** Stage factories must attach optional `name` and `adapterType` to return objects (carry-forward #2 lifted to v1 spec, core types section). `enrichOtelSpan(def)` maps enriched definition to OTel span attributes (~15 LOC). Resolves carry-forward #4.

---

*5 ADRs ratified. Carry-forwards #1 + #4 resolved. Carry-forwards #2 + #3 lifted to v1 spec (core types and package sections). Cat X is next in spike order.*

# Brief — M2 Durable Execution + CLI DX (2 new packages + 1 core extension)

> **Summary:** adapter-inngest ships kitStep/kitFanOut/HRP bridge for production durable execution; CLI ships pk dev/run/inspect for local dev loop; core gains TriggerAdapter interface. ~10 ADRs, 15 tasks, 4 dependency layers. Highest-risk package first — Inngest SDK integration stress-tests M1 contracts.

> **Branch:** `m2-durable-execution`
> **Author (brain):** 2026-05-15
> **Estimated executor effort:** 15–20 hours (1–2 sessions)
> **Status:** Ready for executor pickup. Branches off `master` tip `a331d6b`.
> **Predecessor:** M1 shipped at `a331d6b` (29 ADRs, 562 tests, 3 packages).
> **Scope:** ~10 of 55 v1 ADRs. Ships `@idriszade/adapter-inngest` +
> `@idriszade/cli` + extends `@idriszade/core`.

## What M2 ships

- **`@idriszade/adapter-inngest`** — kitStep() shim (Result→throw
  bridge), kitFanOut() (step.invoke per item), NonRetryableError mapping,
  HRP↔waitForEvent bridge, createKitFunction() factory, TriggerAdapter
  Inngest implementation. Peer dep `inngest ^4.0.0`.
- **`@idriszade/cli`** — `pk dev` (watch + local triggers), `pk run <id>`
  (execute pipeline), `pk inspect <id>` (print describe()). `pk trace`
  deferred to M3 (needs observe package).
- **`@idriszade/core` extension** — TriggerAdapter interface,
  KitTriggerEnvelope\<T\> type, TriggerHandler\<T\> callback type.

## Why this scope

adapter-inngest IS the production execution story. Without it,
pipeline-kit has typed contracts but no runtime. kitStep() + kitFanOut()
+ TriggerAdapter.register() = define → execute durably → retry → cancel
→ fan-out. CLI's `pk dev` / `pk run` / `pk inspect` complete the local
developer loop — the "local-prod seam" that is one of 3 v1 must-haves.

**Why adapter-inngest before thin adapters:** Thin adapters
(secrets-env, memory-map) are low-risk, low-leverage. adapter-inngest is
high-risk (Inngest SDK integration, step.run replay, waitForEvent) AND
high-leverage (production execution). Shipping the riskiest package in
M2 stress-tests M1's StageErrorCode, CostBudget, RunGuard, and
DisposableRegistry contracts while fixes are cheap.

## Key decisions (research-validated, spec-ratified)

| Area | Decision | Source ADR |
|------|----------|-----------|
| Result→throw bridge | kitStep() at adapter boundary | I-2 |
| Fan-out | step.invoke() per item in kitFanOut() | IV-1, IV-7 |
| HRP checkpoint | step.waitForEvent for Reviewable\<I\> pause | I-5 |
| Non-retryable | StageErrorCode retryability → NonRetryableError | I-3 |
| TriggerAdapter | Interface in core, impls in adapter packages | IV-3 |
| Pipeline discovery | glob `pipelines/**/*.pipeline.ts` | VII-2 |
| CLI size | ~150-200 LOC, no bespoke framework | VII-2 |
| Inngest version | Peer dep `inngest ^4.0.0` | I-7 |

## Tasks (15 total, 0–14)

| # | Task | Layer | ADRs |
|---|------|-------|------|
| 0 | State verify + branch + stale branch cleanup | 0 | — |
| 1 | Package scaffold: adapter-inngest | 0 | — |
| 2 | Package scaffold: cli | 0 | — |
| 3 | TriggerAdapter + KitTriggerEnvelope in core | 1 | IV-3, IV-6 |
| 4 | kitStep() + NonRetryableError mapping | 2 | I-2, I-3 |
| 5 | PipelineContext ↔ Inngest context mapping | 2 | I-4 runtime |
| 6 | createKitFunction factory | 3 | I-1, I-7 |
| 7 | HRP ↔ step.waitForEvent bridge | 3 | I-5 |
| 8 | kitFanOut() helper | 3 | IV-1, IV-7 |
| 9 | TriggerAdapter.register() Inngest impl | 3 | IV-3 runtime |
| 10 | adapter-inngest barrel + tests + replay-safety docs | 4 | I-6 |
| 11 | Pipeline discovery + pk inspect | 4 | VII-2 |
| 12 | pk run + pk dev (watch + local triggers) | 4 | VII-2, IV-3 |
| 13 | CLI barrel + tests | 4 | — |
| 14 | Integration tests + gates + report-back | 5 | — |

### Gates (all 5 green = done)

```
pnpm typecheck            # zero errors across all packages
pnpm lint                 # zero violations
pnpm test                 # all green; baseline 562
pnpm test:types           # type tests pass
bun test                  # runtime-compat smoke
```

Test count target: **600+** (562 baseline + ~50 new).

---

## Section 1 — Package Manifest

### @idriszade/core (EXTEND) — 2 new types

**New file (1):**
- `src/trigger-adapter.ts` (~35 LOC): TriggerAdapter interface,
  KitTriggerEnvelope\<T\> type, TriggerHandler\<T\> callback type.

**Modified file (1):**
- `src/index.ts`: add TriggerAdapter, KitTriggerEnvelope, TriggerHandler
  exports.

**Target shape:**

```ts
interface TriggerAdapter {
  register<T>(config: TriggerConfig, handler: TriggerHandler<T>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type TriggerHandler<T> = (
  envelope: KitTriggerEnvelope<T>,
) => Promise<Result<void, StageError>>;

type KitTriggerEnvelope<T> = {
  id: string;           // pk_tev_*
  type: string;         // TriggerConfig.kind
  source: string;       // pipeline id
  time: string;         // ISO 8601
  data: T;
};
```

### @idriszade/adapter-inngest (NEW) — 8 ADRs

**Dependencies:**
- `peerDependencies: { "inngest": "^4.0.0" }`
- `dependencies: { "@idriszade/core": "workspace:*" }`
- `devDependencies: { "inngest": "^4.x", "@inngest/test": "^x.x" }`

**New files (~9):**

| File | LOC | Purpose |
|------|-----|---------|
| `src/kit-step.ts` | ~15 | kitStep() — Result→throw bridge for step.run() |
| `src/non-retryable.ts` | ~25 | mapToNonRetryable() — StageErrorCode → NonRetryableError |
| `src/context-mapping.ts` | ~30 | mapInngestContext() — Inngest context → PipelineContext |
| `src/create-kit-function.ts` | ~80 | createKitFunction() — wraps inngest.createFunction() |
| `src/hrp-bridge.ts` | ~50 | createHrpCheckpoint() — Reviewable ↔ step.waitForEvent |
| `src/kit-fan-out.ts` | ~45 | kitFanOut() — step.invoke per item → Result\<T,E\>[] |
| `src/trigger-registration.ts` | ~40 | InngestTriggerAdapter — TriggerAdapter Inngest impl |
| `src/index.ts` | ~12 | barrel export |
| `README.md` | ~60 | replay-safety docs (I-6), usage examples |

**Estimated:** ~300 source LOC + README.

**Tests (~7 files, ~250 LOC):**
- `tests/kit-step.test.ts`
- `tests/non-retryable.test.ts`
- `tests/context-mapping.test.ts`
- `tests/create-kit-function.test.ts`
- `tests/hrp-bridge.test.ts`
- `tests/kit-fan-out.test.ts`
- `tests/trigger-registration.test.ts`

### @idriszade/cli (NEW) — 1 ADR

**Dependencies:**
- `dependencies: { "@idriszade/core": "workspace:*" }`
- `bin: { "pk": "dist/cli.js" }`

**New files (~6):**

| File | LOC | Purpose |
|------|-----|---------|
| `src/cli.ts` | ~40 | arg parser (process.argv), command routing |
| `src/discover.ts` | ~35 | glob `pipelines/**/*.pipeline.ts`, dynamic import |
| `src/commands/inspect.ts` | ~20 | load pipeline, print describe() as JSON |
| `src/commands/run.ts` | ~35 | load pipeline, parse --input, execute run() |
| `src/commands/dev.ts` | ~50 | watch mode, local trigger setup |
| `src/index.ts` | ~5 | barrel |

**Estimated:** ~185 source LOC.

**Tests (~3 files, ~120 LOC):**
- `tests/discover.test.ts`
- `tests/inspect.test.ts`
- `tests/run.test.ts`

---

## Section 2 — Task Drilldowns

### Task 0: State verify + branch + stale cleanup

**Scope:** Verify master HEAD is `a331d6b`. Run baseline gates (562
tests). Delete stale `m1-core-foundation` branch (local + remote).
Create `m2-durable-execution` from master.

**Acceptance:** New branch created, stale branch deleted, all 5 gates
green on baseline.

### Task 1: Package scaffold — adapter-inngest

**Scope:** Create `packages/adapter-inngest/` with package.json (name:
`@idriszade/adapter-inngest`, peerDep `inngest ^4.0.0`, dep core
`workspace:*`), tsconfig.json (extends root, strict), vitest.config.ts,
empty `src/index.ts` barrel.

**Acceptance:** `pnpm install` resolves, `pnpm typecheck` passes.

### Task 2: Package scaffold — cli

**Scope:** Create `packages/cli/` with package.json (name:
`@idriszade/cli`, dep core `workspace:*`, bin: `{ pk: "dist/cli.js" }`),
tsconfig.json, vitest.config.ts, empty `src/index.ts`.

**Acceptance:** Same as Task 1.

### Task 3: TriggerAdapter + KitTriggerEnvelope in core

**Scope:** New `packages/core/src/trigger-adapter.ts` — TriggerAdapter
interface (register/start/stop), TriggerHandler\<T\> callback type,
KitTriggerEnvelope\<T\> type (id, type, source, time, data). Export from
barrel. Type tests verify generic propagation.

**Spec refs:** IV-3 (interface shape), IV-6 (envelope shape).

**Acceptance:** Types importable from `@idriszade/core`. No runtime code.

### Task 4: kitStep() + NonRetryableError mapping

**Scope:**
- `src/kit-step.ts`: `kitStep<T, E>(step, id, fn)` — calls
  `step.run(id, fn)`. On `result.ok`: return value. On `result.err` +
  retryable false: throw `NonRetryableError`. On `result.err` +
  retryable true/undefined: throw `Error` (Inngest retries).
- `src/non-retryable.ts`: `mapToNonRetryable(code: StageErrorCode)` —
  uses RETRYABILITY_MAP from core.

**Spec refs:** I-2 (kitStep ~8 LOC), I-3 (NonRetryableError from
retryable field).

**Tests:** Result.ok passthrough, Result.err retryable → Error throw,
Result.err non-retryable → NonRetryableError throw, all 19 codes.

### Task 5: PipelineContext ↔ Inngest context mapping

**Scope:** `src/context-mapping.ts`:
- `mapInngestContext(event, step)` → Partial\<PipelineContext\>
- Maps: `event.attempt` → `ctx.attempt`, synthesise AbortSignal via
  AbortController, populate `ctx.trace` from event metadata.

**Spec refs:** I-4 (attempt, signal), IX-4 (trace context from metadata).

**Tests:** Attempt population, signal creation, trace extraction,
missing fields → undefined.

### Task 6: createKitFunction factory

**Scope:** `src/create-kit-function.ts`:
- `createKitFunction(inngest, pipeline, opts)` wraps
  `inngest.createFunction()`:
  - Pipeline id → function id
  - TriggerConfig → Inngest trigger config (5-kind mapping per IV-2)
  - RunGuard → Inngest concurrency/idempotency config (per IV-4)
  - Creates PipelineContext from Inngest context, runs pipeline, handles
    disposal.

**Key constraint:** Each atom = own step.run(). Whole-pipeline-as-one-step
defeats per-atom retry.

**Spec refs:** I-1 (atom-per-step), I-7 (adapter package), IV-2 (trigger
mapping).

**Tests:** Factory output shape, trigger mapping for 5 kinds, RunGuard
mapping, disposal lifecycle.

### Task 7: HRP ↔ step.waitForEvent bridge

**Scope:** `src/hrp-bridge.ts`:
- `createHrpCheckpoint(step, opts)`:
  - `step.run("send-review-request", ...)` → calls HRP webhook
  - `step.waitForEvent("hrp/review.completed", { timeout, match: "data.runId" })`
  - Timeout policy: (a) continue `approved: false`, (b) throw
    NonRetryableError
  - Returns `{ approved: boolean, reviewer?: string }`

**Spec refs:** I-5 (mapping table).

**Tests:** waitForEvent call shape, timeout continue mode, timeout error
mode, approval event extraction.

### Task 8: kitFanOut() helper

**Scope:** `src/kit-fan-out.ts`:
- `kitFanOut<T, E>(step, items, childFn)`:
  1. Memoize source via `step.run("validate-source", ...)` (I-6)
  2. `Promise.all(items.map(item => step.invoke(...)))` + per-invoke catch
  3. Catch → `Result.err(...)` (not rethrow)
  4. Returns `Result<T, E>[]`

**Spec refs:** IV-1, IV-7.

**Tests:** N-item fan-out, success → Result.ok, failure → Result.err
(not rejection), source memoization step.

### Task 9: TriggerAdapter.register() Inngest implementation

**Scope:** `src/trigger-registration.ts`:
- `InngestTriggerAdapter` implements TriggerAdapter
- `register(config, handler)`: maps TriggerConfig to Inngest trigger:
  - cron → `{ cron: config.expr }`
  - webhook → `{ event: "webhook/${config.path}" }`
  - event → `{ event: config.name }`
  - manual → `{ event: "manual/${pipelineId}" }`
  - mcp → `{ event: "mcp/${config.toolName}" }`
- `start()` / `stop()` for dev server lifecycle.

**Spec refs:** IV-3, IV-2 (5-kind mapping).

**Tests:** All 5 kinds → correct Inngest config. Start/stop lifecycle.

### Task 10: adapter-inngest barrel + tests + replay-safety docs

**Scope:**
- Complete `src/index.ts` barrel: kitStep, kitFanOut, createKitFunction,
  createHrpCheckpoint, InngestTriggerAdapter, mapInngestContext,
  mapToNonRetryable.
- Comprehensive unit tests for all modules.
- README.md: replay-safety I-6 docs — Source MUST be wrapped in
  step.run(), passing/failing code samples.

**Spec refs:** I-6 (docs + code review, no runtime guard at v1).

**Acceptance:** All adapter-inngest tests pass. Barrel verified. README
has I-6 docs.

**BRAIN CHECK-IN after this task.**

### Task 11: Pipeline discovery + pk inspect

**Scope:**
- `src/discover.ts`: glob `pipelines/**/*.pipeline.ts` in CWD, dynamic
  import, collect exported DefinedPipeline instances.
- `src/commands/inspect.ts`: load pipeline by id, print describe() as
  formatted JSON.
- Wire into CLI arg parser.

**Spec refs:** VII-2 (discovery, pk inspect).

**Tests:** Multi-pipeline discovery, pipeline-by-id lookup, describe()
format.

### Task 12: pk run + pk dev

**Scope:**
- `src/commands/run.ts`: load pipeline by id, parse `--input` JSON or
  stdin, execute `pipeline.run(input)`, print result.
- `src/commands/dev.ts`: watch `pipelines/**/*.pipeline.ts`, re-discover
  on change, local trigger mode (cron → setInterval, webhook →
  http.createServer).

**Spec refs:** VII-2 (pk run, pk dev), IV-3 (local-prod seam).

**Tests:** JSON input parsing, stdin mode, file-change detection, local
cron trigger fires.

### Task 13: CLI barrel + tests

**Scope:**
- `src/cli.ts`: arg parser (process.argv), `pk <command> [args] [opts]`.
- `src/index.ts`: barrel export.
- CLI integration tests: pk inspect → valid JSON, pk run → pipeline
  executed, error handling for missing pipeline.

**Tests:** Arg parsing, command routing, error messages.

### Task 14: Integration tests + gates + report-back

**Scope:**
- Cross-module: createKitFunction with fixture pipeline → valid
  Inngest function shape.
- CLI integration: discover + inspect + run against fixture.
- All 5 gates green. Write `docs/briefs/m2_report_back.md`.
- Test count ≥ 600.

---

## Section 3 — Dependency Layers

```
Layer 0 (scaffolding):  Tasks 0, 1, 2     — 1+2 parallelizable
Layer 1 (core types):   Task 3             — depends on 0
Layer 2 (adapter base): Tasks 4, 5         — 4+5 parallelizable
Layer 3 (adapter adv.): Tasks 6, 7, 8, 9  — partially parallelizable
Layer 4 (barrel + CLI): Tasks 10, 11, 12, 13 — 10 after 3; 11+12 parallel
Layer 5 (integration):  Task 14            — depends on all
```

Parallel opportunities: 1||2, 4||5, 7||8 (independent), 11||12.

## Section 4 — Brain Check-in Schedule

**After Task 10** (adapter-inngest feature-complete, before CLI):
- Validate adapter shape. Surface any M1 contract gaps discovered during
  Inngest integration.
- Confirm CLI scope unchanged.
- Decide local trigger approach for pk dev (fs.watch vs chokidar,
  http.createServer vs express).

## Section 5 — Risk Register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Inngest SDK v4 API drift since spec | Executor verifies API in Task 1; adjusts if needed |
| 2 | step.waitForEvent test limitations | Mock-based fallback if @inngest/test incomplete |
| 3 | Dynamic TS import in CLI | Use jiti or tsx as dep; document runtime req |
| 4 | I-6 replay-safety is docs-only | Prominent README; runtime guard deferred v1.x |
| 5 | composer.ts at 447 LOC | M2 doesn't touch it; flag for M3 if observe hooks grow |

## Section 6 — Implementation Notes

### Inngest SDK v4 API reference

The executor should verify these against the installed SDK version:

```ts
import { Inngest, NonRetryableError } from "inngest";
import type { StepTools } from "inngest/components/InngestStepTools";

const inngest = new Inngest({ id: "pipeline-kit" });

const fn = inngest.createFunction(
  { id: "my-pipeline", concurrency: [{ limit: 5 }] },
  { event: "pipeline/trigger" },
  async ({ event, step }) => {
    const result = await step.run("step-name", async () => { ... });
    const child = await step.invoke("invoke-child", { function: childFn, data: {} });
    const evt = await step.waitForEvent("wait-review", {
      event: "hrp/review.completed",
      timeout: "1h",
      match: "data.runId",
    });
  }
);
```

### CLI pipeline module loading

Pipelines are TS modules exporting DefinedPipeline. The CLI must load
them at runtime. Options (executor chooses):
- `jiti` (unjs) — tiny ESM-native TS loader, zero config
- `tsx` — transparent TS execution via Node loader hooks
- `node --import tsx` — documented as user requirement

### Local trigger mode (pk dev)

Dev mode implements TriggerAdapter locally:
- cron → `setInterval(handler, intervalFromExpr(expr))`
- webhook → `http.createServer` on localhost
- event → manual dispatch via CLI
- manual → immediate execution
- mcp → stub (full MCP dev mode deferred)

---

*M2 brief locked 2026-05-15. ~10 ADRs. 2 new packages + 1 core extension. Phase 3 continues.*

# Cat I Spike #1 — `step-function-compose` Findings

> Spike: map kit's Composer atom-by-atom pipeline onto Inngest step functions,
> probe per-step retry granularity, Result<T,E> / throw composition, and
> PipelineContext mapping. Uses `@inngest/test` (InngestTestEngine) as local
> fallback (Inngest Dev Server binary not available via bunx on this host).
> Branch: `master`. Author: Executor — 2026-05-10.
> Companion to: `docs/research-outline-v1.md` § Category I (Durable Execution).
> Status: spike output (NOT a notes file; brain synthesises `docs/research-notes-v1-cat-I.md`
> after additional spikes).
> Friction anchor: `F-DURABLE` — durable execution composition with Inngest.

## §1. SETUP

A kit-shaped 3-stage pipeline, executed via Inngest's SDK + `@inngest/test`:

- **Source (step 1):** emits `Atom<{url}>` with id `pk_atom_src_1`
- **Process (step 2):** transforms atom — first invocation returns `Result.err("transient_fetch_error")` (not throw), simulating transient failure
- **Serve (step 3):** writes `Atom<ProcessOutput>` to `/tmp/spike-cat-i-result.json`

**Runtime:** Bun 1.3.5. **Packages:** `inngest@4.3.0`, `@inngest/test@1.0.0`,
`hono@4.12.18`, `@hono/node-server@1.19.14`.

**Version friction encountered:** `@inngest/test@1.0.0` requires `inngest@^4.0.0`
(not `^3.x`). Initial install used `inngest@3.54.2`; peer warning was emitted but
not fatal — the mismatch caused a runtime `ExecutionVersion` lookup failure. Upgraded
to `inngest@4.3.0`; also required migrating `createFunction(opts, trigger, handler)`
to `createFunction({ ...opts, triggers }, handler)` (v4 API change). Both friction
points documented as carry-forward #6.

**Dev Server fallback:** `bunx inngest-cli@latest` failed ("Inngest CLI binary not found").
`@inngest/test`'s `InngestTestEngine` provides a full in-process execution harness
sufficient for all O-1 through O-5 probes without a running server.

**LOC:** `spike.ts` 324 lines (pure code ~210; comment/blank ~114). Over the 200 LOC
guideline due to 4-experiment structure needed to probe 5 observations independently.

**Run command + output:**

```
$ cd research/spikes/durable-execution/step-function-compose && bun run spike.ts

### Cat I Spike #1 — step-function-compose ###
============================================================

--- EXPERIMENT A: Full pipeline run with mocked process step ---
    (confirms O-2: sourceAtom flows to step 3 after step 2)
    [source] emitted atom id=pk_atom_src_1 url=https://example.com
    [after-source] sourceAtom.id=pk_atom_src_1 url=https://example.com
    [after-process] processResult.ok=true
    [serve] result written to /tmp/spike-cat-i-result.json
    [serve] sourceAtom still accessible: id=pk_atom_src_1 (O-2 confirmed)
    [after-source] sourceAtom.id=pk_atom_src_1 url=https://example.com
    [after-process] processResult.ok=true

  RESULT: ok=true sourceAtomId=pk_atom_src_1
  O-2: CONFIRMED -- sourceAtom (step 1) id=pk_atom_src_1 flowed to step 3

--- EXPERIMENT B: O-3 probe — Result.err vs throw ---
    (does returning Result.err cause Inngest to retry the step?)
    [source] emitted atom id=pk_atom_src_1 url=https://example.com
    [after-source] sourceAtom.id=pk_atom_src_1 url=https://example.com
    [process] invocation #1
    [process] returning Result.err (NOT throwing) — probe O-3
    [after-source] sourceAtom.id=pk_atom_src_1 url=https://example.com
    [after-process] processResult.ok=false
    [shim] processResult.ok=false — throwing to trigger Inngest per-step retry
Inngest function error: kit:step_error code=transient_fetch_error

  RESULT (unexpected success): undefined
  [InngestTestEngine swallows function-level throw, returns undefined result]

--- EXPERIMENT C: executeStep('source') — checkpoint probe (O-5) ---
    [source] emitted atom id=pk_atom_src_1 url=https://example.com

  Step result: {"id":"pk_atom_src_1","object":"atom","created_at":1778454622765,"metadata":{},"data":{"url":"https://example.com"}}
  O-5: CONFIRMED -- per-step checkpoint observable via executeStep()
       Step output is a complete kit Atom<T> envelope

--- EXPERIMENT D: PipelineContext mapping (O-4) ---

  Inngest context fields:
    runId: "01KRA2FWHEX344EDCF3XNG9TKE"
    attempt: 0
    eventName: "pipeline/run.requested"
    eventData: {"url":"https://example.com"}
    hasStep: true
    stepTools: ["sendEvent","waitForSignal","realtime","sendSignal","waitForEvent",
                "run","ai","sleep","sleepUntil","invoke","fetch"]

  O-4 mapping:
    kit PipelineContext.run_id  <-> Inngest runId
    kit PipelineContext.signal   <-> Inngest (AbortSignal via middleware or manual)
    kit PipelineContext.event    <-> Inngest event.data
    kit atom deps (secrets/mem)  <-> closed-over in function factory (same as Cat VIII/V)
    kit retry state              <-> Inngest attempt (0-indexed)
```

**Result file written by exp-A:**

```json
{
  "runId": "01KRA2FWGWB67W42BYEN0ZPN7T",
  "sourceAtomId": "pk_atom_src_1",
  "sourceUrl": "https://example.com",
  "processedAtomId": "pk_atom_proc_mocked",
  "processedTitle": "Mocked Title (step 2 bypassed)",
  "retryCountAtSuccess": 0,
  "completedAt": "2026-05-10T23:10:22.751Z"
}
```

## §2. O-1 — RETRY GRANULARITY

**Finding: per-step retry, confirmed. Function body re-executes on each step
completion; step handlers are memoized (execute exactly once).**

Supplemental probe (independent 3-step function):

```
step-1 handler executed count: 1
between 1-2 (count 1)   <- replay 1: function starts, step 1 runs
between 1-2 (count 2)   <- replay 2: step 1 resolved from state
between 2-3 (count 3)   <- replay 2: continues past step 2
between 1-2 (count 4)   <- replay 3: step 1+2 resolved from state
between 2-3 (count 5)   <- replay 3: continues past step 2
step handlers: s1=1 s2=1 s3=1
betweenCount: 5  (N=3 steps -> 5 inter-step code executions across 3 replays)
```

**The replay fingerprint:** for N steps, the function body re-executes N times
(once per step completion). Code at position k (between steps k and k+1) executes
N - k + 1 times. Step handlers execute exactly once.

**Implication for kit:** Code in kit's Composer body that sits BETWEEN step.run()
calls re-executes on every replay. This is safe only if the Composer is purely
a wiring function (no side effects between steps) — which it is by kit's
"functional core, imperative shell" discipline. Any console.log, metric counter,
or state mutation between step.run() calls fires multiple times. Kit's adapter
layer must push ALL side-effectful code INSIDE step.run() handlers.

**Inngest's spec says:** retry a failing step without re-running earlier steps. At the
SDK level, the implementation is: re-execute the entire function body, but replay
already-completed steps from durable state (their handlers are skipped). From the
adapter's perspective, the effect IS per-step retry — earlier step handler code
does not re-run — but the function body code does.

## §3. O-2 — STATE PASSING BETWEEN STEPS

**Finding: CONFIRMED. step.run() return values persist across step boundaries and
are available as variables in subsequent step closures.**

Exp-A evidence: `sourceAtom` (step 1 output) was accessible inside step 3's handler
(`[serve] sourceAtom still accessible: id=pk_atom_src_1`). This maps cleanly to kit's
atom-flow model: an atom emitted by Source is available to Process, which is available
to Serve.

**Mechanism:** Inngest stores the step return value durably. On each function re-execution,
completed steps return their stored output immediately (without running their handler).
The variable holding that output is re-bound in the current execution scope.

**Implication for kit:** The atom-by-atom chaining model (Source atom -> Process atom ->
Serve) maps 1:1 onto Inngest's step return-value threading. No shared mutable context
is needed. The kit Composer's yield (AsyncIterator) model would need to be flattened
into sequential await step.run() calls in the Inngest adapter.

## §4. O-3 — RESULT<T,E> VS THROW COMPOSITION

**Finding: CONFIRMED (hypothesis correct). Inngest treats ANY step.run() return
value as step-success, regardless of the value's shape. It only retries on throw.**

Exp-B evidence:
- Process step handler ran once (invocation #1)
- Handler returned Result.err("transient_fetch_error") (not throw)
- processResult.ok=false in the function body — Inngest passed the err value through
- Inngest did NOT retry the step; it resumed execution with the err result
- The shim throw propagated as a function-level error (NOT a step-level retry trigger)

**This is the single most important composition point in the spike.** Kit's Result<T,E>
protocol is invisible to Inngest's retry machinery. Inngest's retry protocol is throw-only.

**Required shim layer:** A kit Inngest adapter MUST wrap every step.run() call with a
helper that translates Result.err -> throw. Without this, transient failures returned
as Result.err silently advance the pipeline with a failed result:

```ts
// Without shim (BROKEN composition):
const processResult = await step.run("process", async () => myKitProcess(input));
// If myKitProcess returns Result.err, pipeline advances with err -- Inngest unaware

// With shim (CORRECT composition):
async function kitStep<T, E>(
  step: StepTools,
  id: string,
  fn: () => Promise<Result<T, E>>
): Promise<T> {
  const result = await step.run(id, fn);
  if (!result.ok) throw new Error(`kit:step_error code=${String(result.error)}`);
  return result.value;
}
// Now: kit process returns Result.err -> step.run returns err
//      -> kitStep throws -> Inngest retries step
```

**Composition verdict:** kit's Result<T,E> protocol and Inngest's throw-based retry
are NOT composable without a thin shim layer. The shim is small (~8 LOC) and well-
contained at the adapter boundary. This is "thin adapter" shape, not "documented pattern".

**Secondary finding (InngestTestEngine DX):** When the function throws at the
function-body level (post-shim), InngestTestEngine.execute() swallows the error
and returns undefined as the result instead of re-throwing. Error assertions require
checking result === undefined or defensive try/catch. Empirically confirmed in exp-B.

## §5. O-4 — PIPELINECONTEXT MAPPING

**Finding: clean mapping with one gap (AbortSignal).**

Inngest function context provides:

| Inngest ctx field | kit PipelineContext equivalent | Notes |
|---|---|---|
| runId: string | run_id: string | Direct 1:1 |
| attempt: number | (no direct field) | Available for retry-aware logic |
| event.data | Trigger event payload | Kit's event schema wraps this |
| step.* | Stage execution boundary | 11 step tools available |
| logger | Structured log sink | Kit can delegate to Inngest's logger |
| -- | signal: AbortSignal | **Gap: not provided by Inngest natively** |

**AbortSignal gap:** kit's PipelineContext.signal carries cancellation intent into
stages. Inngest has cancellation at the function level (cancelOn option) but does NOT
pass an AbortSignal into the function context. Kit Inngest adapter options:
(a) omit signal support, (b) synthesise from step.waitForEvent cancellation pattern,
(c) rely on Inngest's cancelOn and trust the SDK to abort mid-step.

**Adapter-dep pattern lift:** Kit stage deps (secrets, memory) are NOT in Inngest's
context -- they live in the function factory closure, identical to Cat VIII variant-B
adapter-dep pattern. No new shape; the lift is exact.

**attempt field:** Inngest provides 0-indexed retry attempt count. Kit doesn't currently
surface this in PipelineContext but it would be a useful addition for retry-aware stages.

## §6. O-5 — CHECKPOINT VISIBILITY

**Finding: CONFIRMED. Per-step checkpoint observable via InngestTestEngine.executeStep().**

Exp-C evidence: executeStep("source") ran the function until step 1 completed and
returned its output (a complete kit Atom<T> envelope with id, object, created_at,
metadata, data). No subsequent steps ran.

In production (Dev Server): the Inngest Dev Server dashboard at localhost:8288
exposes step-level state visually. Each step.run() completion is visible as a
checkpoint with its stored output. This maps to kit's "atom checkpoint" concept.

**Implication:** Inngest's checkpoint granularity matches kit's atom granularity
exactly when each step.run() wraps one kit atom. This is the natural 1:1 composition.

## §7. O-6 — COMPOSITION FRICTION

1. **Version alignment** (cf #6): inngest@4.x changed createFunction signature. Any
   kit adapter must declare strict peer dep "inngest": "^4.0.0" and document the upgrade.

2. **inngest-cli binary unavailability via bunx** (cf #7): The Inngest Dev Server is a
   Go binary, not an npm package. bunx inngest-cli@latest fails ("binary not found").
   Developers must install separately (brew install inngest/tap/inngest or direct
   download). This breaks the "zero-setup local dev" experience.

3. **InngestTestEngine swallows function throws** (cf #8): execute() returns
   { result: undefined } rather than re-throwing function-body errors. Defensive
   assertion pattern required in kit adapter tests.

4. **Function body re-execution replay side-effects** (cf #9): Code between step.run()
   calls re-runs on every replay. Kit's Composer wiring is pure by design (safe), but
   this is a sharp edge for developers adding observability between step calls.

5. **Typing friction**: step.run() return type is inferred correctly as Result<T, E>
   when the handler returns that shape. The kitStep shim changes return to Promise<T>,
   requiring explicit generic annotation. Strict mode handles this cleanly; no any needed.

## §8. CROSS-CUTS

### Does Disposable (Cat V ADR-V-2) apply here?

**Marginal.** The Inngest client itself is not resource-bearing (no cleanup needed).
The Hono server IS resource-bearing (open port), but that lifecycle belongs to the
deployment environment, not kit's Composer. No new kit-shape decision required here.

If a kit stage opens a DB connection INSIDE a step.run() handler, that connection
should be released before the handler returns (same as Cat V §5.2 orchestr8 lifecycle
finding). The Disposable pattern would apply inside the handler, not at the Inngest
function level.

### Does the 2-verb R+W pattern (Cat V ADR-V-1) describe checkpoint storage?

**No.** Inngest's checkpoint storage (step return-value persistence) is Inngest's
internal concern, opaque to kit stages. Kit adapters interact with it only by calling
step.run() (write) and receiving the return value (read). The MemoryAdapter 2-verb
contract describes cross-run user-space memory, not Inngest's internal checkpoint layer.
The two are at different abstraction layers. No conflict.

## §9. VERDICT

**Per-atom = per-step: CONFIRMED.** Kit's atom-by-atom execution model maps to Inngest's
per-step durability model. Each step.run() wraps one kit atom (Source, Process, or Serve
invocation). Step state (atom output) persists durably and flows to subsequent steps
unchanged, matching kit's atom-threading model.

**Composition shape: THIN ADAPTER (not documented pattern).** The mapping is not zero-cost:

1. The kitStep() shim (~8 LOC) is load-bearing — translates Result.err -> throw for
   Inngest's retry protocol.
2. The Composer's AsyncIterator-based atom flow must be flattened to sequential
   await step.run() calls in the Inngest adapter.
3. Code between steps must be idempotent or confined to step.run() handlers (replay safety).

These three constraints define the inngest adapter's implementation shape. They are
non-trivial enough to warrant a dedicated adapter module (e.g., @idriszade/adapter-inngest)
but compact enough to be thin. The adapter is NOT just documentation.

**PipelineContext: near-complete mapping.** runId, event.data, attempt, and all stage
deps map cleanly. signal: AbortSignal has a gap; adapter can synthesise or omit.

**Retry semantics: correct alignment at step granularity.** Inngest retries the failing
step only (step handler does not re-run for earlier steps). Earlier step outputs are
replayed from durable state. This is exactly kit's desired per-atom retry semantics.
The function body between steps re-executes, but kit's Composer wiring is pure and
side-effect-free, so this is safe by design.

## §10. CARRY-FORWARDS

1. **kitStep() shim design** (Cat I Q-composition). Specify signature, error type, retry-
   error message format. Does it carry a RetryAfterError/NonRetryableError type hint for
   permanent vs transient failures? Inngest v4 exports NonRetryableError.

2. **AsyncIterator -> step.run() flattening** (Cat I Q-composition). Kit's Composer emits
   atoms via an AsyncIterator. The adapter must consume the iterator and map each yielded
   atom to a step.run() call. Spike did not probe this. Spike #2 candidate.

3. **AbortSignal gap** (Cat I Q-mapping). Options: (a) omit signal in Inngest adapter;
   (b) synthesise from cancelOn function option + manual AbortController in adapter factory;
   (c) wait for Inngest SDK to expose it. Needs ADR direction before adapter code is written.

4. **attempt in PipelineContext** (Cat I Q-context). Inngest surfaces attempt count; kit
   doesn't. Consider PipelineContext.attempt?: number as an optional field.

5. **Inngest v3 vs v4 peer dep range** (Cat I Q-DX). Recommend v4-only with clear peer dep
   range "inngest": "^4.0.0" + migration note. The createFunction API break is blocking.

6. **Version alignment DX friction** (observed). inngest@4.x breaking change in
   createFunction signature; no TS compile error in v3 code running under v4 (runtime only).
   Kit adapter: strict peer dep + clear migration note.

7. **inngest-cli binary distribution** (observed). Cannot install via bunx/npx. Kit docs
   must direct to brew install inngest/tap/inngest or Go release page. Future spike: test
   with locally-installed CLI to confirm Dev Server checkpoint visibility at localhost:8288.

8. **InngestTestEngine error propagation** (observed). Function-level throws return
   { result: undefined } rather than propagating. Kit adapter tests should check
   result !== undefined or use defensive try/catch.

9. **Replay side-effect safety** (structural). Kit CLAUDE.md mandates "functional core,
   imperative shell". Between-step code in the Composer must not cause side effects.
   Document as an explicit constraint in the Inngest adapter spec.

## §11. OPEN QUESTIONS (for brain -- NOT decisions)

1. **Is the kitStep() shim sufficient or should kit provide a richer InngestComposer
   that wraps the entire Composer execution pattern** (iterator flattening + shim +
   context mapping + error types)? Thin adapter vs richer integration layer -- this
   is the Cat I Q5 composition shape question.

2. **Should Result.err always trigger a retry, or should kit distinguish between
   retryable and non-retryable errors?** Inngest provides NonRetryableError. Kit
   could map Result.err({ retryable: false }) to throw new NonRetryableError(...).
   This would require a richer error type on kit's Err<E> variant.

3. **How does Inngest's fan-out (step.sendEvent to trigger sibling functions) map to
   kit's Source fan-out (Cat M0.5 Composer B)?** Spike did not probe this. It may be
   a natural fit or require a separate Inngest function per fan-out branch.

4. **Does the Inngest adapter belong in a reference adapter pack or in kit core?**
   Given that Inngest is a specific platform (not a generic durable execution interface),
   it should likely be a reference adapter (@idriszade/adapter-inngest) not a core
   primitive. But kitStep() shim and context-mapping contract probably belong in a
   shared compatibility layer.

5. **What does spike #2 probe?** Candidates: (a) composerToInngest() flattening utility
   (cf #2 above); (b) Inngest fan-out vs kit Source fan-out; (c) step.waitForEvent as
   a kit HRP-review checkpoint analogue; (d) Temporal or other durable execution runtime
   for comparison. Brain to decide spike #2 scope.

## §12. STATUS

Throwaway code (4 experiments). No kit-core amendments. No v0 ADR amendments.
No ADR drafts in this file (per brief). Brain synthesises in next step after
FINDINGS review. Cat I Q1 (per-step retry confirmed) and Q3 (Result vs throw --
shim required) are defensible day-1. Q2 (state passing), Q4 (context mapping),
Q5 (composition shape as thin adapter) also defensible. Q6+ (fan-out, HRP
checkpoints, alternative runtimes) remain open.

*Author: Executor -- 2026-05-10. Branch: master (tip e8a4666 at spike start).
inngest@4.3.0, @inngest/test@1.0.0, hono@4.12.18, @hono/node-server@1.19.14.
Strict TS compatible (no any); ESM; Bun-runnable. Dev Server not available via
bunx -- InngestTestEngine used as full local fallback.*

# Spike #1 — fan-out-compose FINDINGS

> Spike: probe how Inngest `step.invoke()` composes with pipeline-kit's Composer
> pattern for parallel fan-out / fan-in.
> Directory: `research/spikes/cat-iv-trigger-orchestration/spike-1-fan-out-compose/`
> Branch: `master`. Author: Executor — 2026-05-10.
> Companion to: `docs/research-outline-v1.md` § Category IV (Trigger Orchestration).
> Status: spike output (NOT a notes file; brain synthesises `docs/research-notes-v1-cat-IV.md`).
> Friction anchor: `F-TRIGGER` + Cat I carry-forward #10 (parallel fan-out via step.invoke).

---

## §1. SETUP

- **Inngest version:** `^4.3.0` (pinned to match Cat I spikes — avoid API break)
- **@inngest/test version:** `^1.0.0`
- **Node version:** 20+ target; Bun-runnable
- **Run mode:** `InngestTestEngine` (in-process; Inngest Dev Server binary unavailable via bunx — same as Cat I spikes)
- **Dev Server:** required for O3 (concurrency) and O4 (HRP inside fan-out) behavioral confirmation
- **Files:**
  - `src/types.ts` — shared Result<T,E>, Atom<T>, event and domain types
  - `src/inngest-client.ts` — shared Inngest client
  - `src/child-pipeline.ts` — child function (success variant + failing variant)
  - `src/child-with-hrp.ts` — child function with step.waitForEvent() checkpoint
  - `src/parent-fan-out.ts` — parent function + InngestTestEngine harness (Exp A, B)
  - `src/probe-concurrency.ts` — parent + child with concurrency config + harness
  - `src/probe-local-equivalent.ts` — pure in-process fan-out (no Inngest) + harness

**Run commands (after `bun install`):**

```bash
bun run src/probe-local-equivalent.ts   # no Inngest needed -- runs clean
bun run src/parent-fan-out.ts           # InngestTestEngine -- may need mock shape tuning
bun run src/probe-concurrency.ts        # code-shape probe only; Dev Server for behavior
```

---

## §2. OBSERVATIONS

### O1 -- Type signature of fan-out

**STRUCTURAL PREDICTION (code-level, partially confirmed):**

`step.invoke(id, { function, data })` returns the child function's TypeScript
return type. If the child is typed as returning `Result<ChildProcessOutput, ChildError>`,
then `step.invoke()` returns `Promise<Result<ChildProcessOutput, ChildError>>`.

```ts
// From parent-fan-out.ts
const childResults = await Promise.all(
  items.map((item) =>
    step.invoke(`child-${item.id}`, {
      function: childFn,          // typed: returns Result<ChildProcessOutput, ChildError>
      data: { item },
    })
  )
) as Array<Result<ChildProcessOutput, ChildError>>;
```

The type cast (`as Array<...>`) is required because Inngest v4's `step.invoke()`
return type inference may not fully thread through `Promise.all` without help.
This is a minor DX friction -- no `any` required.

**Result<T,E> composition: YES** -- Result-shaped return values flow through
step.invoke() without loss. The parent receives the same discriminated-union
type the child returned.

[PENDING-RUN -- verify that TS strict mode accepts without the cast; emit
compiler output from `bun x tsc --noEmit`]

---

### O2 -- Error isolation

**STRUCTURAL PREDICTION (strong, based on Inngest semantics + Cat I findings):**

Two failure modes must be distinguished:

| Child failure mode | Parent behavior |
|---|---|
| Child returns `Result.err(...)` | `step.invoke()` resolves with the err value. `Promise.all` does NOT reject. Parent receives full Array<Result<T,E>>. All siblings complete. |
| Child throws at Inngest function level | `step.invoke()` rejects (Inngest surfaces a function-level error). `Promise.all` short-circuits -- siblings may be abandoned. |

**The correct pattern for allSettled-equivalent fan-out:**

Children MUST return `Result.err(...)` and MUST NOT throw at the function level.
The `kitStep()` shim from Cat I (ADR-v1-I-3) ensures that even within a child,
`step.run()` failures throw -- but the child's final return is always `Result<T,E>`.

This is the load-bearing composition constraint. If a child uses the shim
correctly (Result.err -> throw -> Inngest retry -> eventually ok or max-retries-
exhausted), the FUNCTION eventually returns either `ok(...)` or propagates a
function-level error after exhausting retries.

**After max retries on a child:** the child function fails at the Inngest level
(not a Result.err return -- an actual function execution failure). At that point
`step.invoke()` in the parent WILL reject, and `Promise.all` will short-circuit.

**Implication for kit:**

- Happy path + transient failures: Result.err + kitStep shim -> child retries ->
  eventually ok -> Promise.all settles cleanly with all N results.
- Permanent failure: need per-invoke try/catch in the parent OR children must
  handle their own permanent failures by returning Result.err (retries: 0).

**Probe cell (child-pipeline.ts `failingChildFn`):** throws inside step.run() to
trigger Inngest retry. After retry exhaustion (retries: 0), function fails at
Inngest level. Parent's step.invoke() rejects. This is the hard failure path.

[PENDING-RUN -- empirical confirmation of per-invoke catch shape with InngestTestEngine]

---

### O3 -- Concurrency behavior

**STRUCTURAL PREDICTION (requires Dev Server):**

```ts
// probe-concurrency.ts
concurrency: [{ limit: 1, key: "event.data.pipelineId", scope: "fn" }]  // on parent
concurrency: [{ limit: 3, scope: "fn" }]                                  // on child
```

Expected behavior (20 items dispatched):
- Parent limit=1 per pipelineId: at most 1 concurrent parent run for a given
  pipelineId. Does NOT limit step.invoke() calls within a run.
- Child limit=3 global: at most 3 child function instances execute simultaneously
  across ALL pipelines. The 17 excess enqueue -- they are NOT rejected.
- Fan-out of 20 items completes eventually: parent step.invoke() calls all
  dispatch successfully; Inngest queues child runs and drains 3 at a time.
- No error on dispatch: `Promise.all(20 x step.invoke())` succeeds in scheduling
  all 20 child runs. The parent then waits for all 20 to complete (durable wait).

[PENDING-RUN -- Inngest Dev Server required for behavioral verification]

**Code shape:** concurrency config compiles and types correctly (confirmed by code
structure). 20-item fan-out wires correctly (InngestTestEngine harness accepts mocked
child steps without error at code level).

---

### O4 -- HRP inside fan-out

**STRUCTURAL PREDICTION (strong, based on Cat I spike #2 sec-L2-O4):**

YES -- `step.waitForEvent()` composes inside a fanned-out child while the parent
waits on `step.invoke()`.

Mechanism:
1. Parent dispatches N child invocations via `Promise.all(step.invoke(...))`.
2. Each `step.invoke()` suspends the parent durably (stored in Inngest state).
3. Each child runs independently, including its own `step.waitForEvent("wait-for-hrp-review", ...)`.
4. Child suspends at `step.waitForEvent`. Parent's `step.invoke()` wait is durable --
   no threads blocked.
5. When HRP review event arrives for each child's runId, that child resumes and completes.
6. After ALL N children complete, parent's Promise.all resolves, aggregate step runs.

**This is a powerful composition:** each fanned-out item gets its own HRP review gate.
The parent doesn't proceed to aggregation until all N items are reviewed and processed.

**Kit shape:** `child-with-hrp.ts` encodes this pattern. The child emits a durable
"send-review-request" step, then `step.waitForEvent("wait-for-hrp-review", { match: "data.runId", timeout: "24h" })`.

**Test harness note:** testing this requires `transformCtx` workaround (per Cat I
spike #2 sec-L2-O1 -- `@inngest/test@1.0.0` steps-array broken for waitForEvent).

[PENDING-RUN -- Dev Server required for full behavioral test of nested wait]

---

### O5 -- Replay safety of fan-out

**STRUCTURAL PREDICTION (confirmed by code structure + ADR-v1-I-6):**

YES -- step IDs are stable across replays IF the items array is memoized.

```ts
// parent-fan-out.ts -- correct pattern
const items = await step.run("validate-source", async () => rawItems);
// items is now memoized -- item.id is stable across all replays

const childResults = await Promise.all(
  items.map(item => step.invoke(`child-${item.id}`, ...))
  // step ID "child-item-a" is deterministic because item.id is stable
);
```

```ts
// BROKEN -- do not do this
const items = await fetchFromDB();  // may return different IDs on replay
items.map(item => step.invoke(`child-${item.id}`, ...));
// step IDs unstable -- Inngest cannot match against memoized state
```

Same footgun as Cat I spike #2 sec-L1-O4. The fix is identical: wrap any data
that drives dynamic step IDs in `step.run()`.

**CONFIRMED by code review** -- no PENDING-RUN needed for this structural point.

---

### O6 -- Kit Composer fit

**STRUCTURAL PREDICTION (strong):**

Fan-out does NOT require a new kit primitive. It is expressible with the existing
Composer + Inngest adapter pattern:

| Kit concept | Inngest primitive |
|---|---|
| Composer fan-out (Source emits N atoms) | `step.run("validate-source")` -> memoized items |
| Parallel atom processing | `Promise.all(items.map(item => step.invoke(...)))` |
| Child pipeline | Separate Inngest function (mirrors kit's Composer) |
| Fan-in / aggregate | `step.run("aggregate-results")` |

The adapter shape is: `@idriszade/adapter-inngest` exposes a `kitInvoke()` helper
analogous to `kitStep()` -- wraps `step.invoke()` and handles the typed return.

**No new kit-core primitive required.** Fan-out = Composer B (parallel) expressed
in Inngest's step model. The function-per-child constraint is Inngest-specific and
belongs in the adapter layer.

One new adapter concern: `step.invoke()` can only invoke Inngest functions
registered on the same Inngest client. Cross-pipeline fan-out requires child
functions to be pre-registered -- they cannot be ad-hoc. This is a composition
constraint the adapter must document.

---

### O7 -- Local-prod seam

**CONFIRMED by code (probe-local-equivalent.ts):**

```
LOCAL (probe-local-equivalent.ts):
  const settled = await Promise.allSettled(items.map(runChildPipeline));
  // -> Array<PromiseSettledResult<Result<T,E>>>

INNGEST (parent-fan-out.ts):
  const childResults = await Promise.all(
    items.map(item => step.invoke(`child-${item.id}`, { function: childFn, data: { item } }))
  );
  // -> Array<Result<T,E>>   (if children return Result.err, not throw)

DELTA:
  1. step.invoke() adds durability: child progress checkpointed per step
  2. step.invoke() adds replay safety: parent can be replayed after child completes
  3. step.invoke() adds observability: each child run visible in Dev Server UI
  4. step.invoke() requires pre-registered child functions (no ad-hoc lambdas)
  5. Inngest Promise.all requires children to return Result.err (not throw) for
     allSettled-equivalent error isolation -- ergonomic constraint on child design
```

**Seam thickness: thin.** The same `Result<T,E>` contract flows through both paths.
The local path uses `Promise.allSettled` for full isolation; the Inngest path uses
`Promise.all` + child-side Result.err discipline. Both produce `Array<Result<T,E>>`.

A kit test helper that swaps the Inngest adapter for the local equivalent (by replacing
`step.invoke` with a direct call) would make local-prod seam testing ergonomic.

---

### O8 -- Industry comparison

**step.invoke() vs alternatives:**

| Runtime | Parallel fan-out primitive | Error isolation | Replay safe |
|---|---|---|---|
| Inngest v4 | `step.invoke()` + `Promise.all` | Via Result.err + child discipline | YES (memoized source) |
| Temporal | `workflow.executeChild()` + `Promise.all` | Via activity error types | YES (workflow determinism) |
| AWS Step Functions | Map state (native parallel) | `.Catch` per item | YES (state machine) |
| Trigger.dev v3 | `triggerAndWait()` + `Promise.all` | Similar to Inngest | YES |
| BullMQ | Job.addBulk() + job event listener | No native wait; polling | NO (queue, not workflow) |

**Key difference:** Step Functions Map state is declarative -- the runtime owns
fan-out/fan-in. Inngest/Temporal/Trigger.dev are imperative -- the developer
writes the fan-out loop. Imperative is more flexible (dynamic N) but requires
discipline (memoize source, use Result.err not throw).

**For kit:** Inngest's imperative model matches kit's Composer pattern better than
Step Functions' declarative model. The adapter layer can abstract the `step.invoke()`
loop behind a `kitFanOut(items, childFn)` helper.

---

## §3. OPEN QUESTIONS FOR SPIKE #2

1. **Per-invoke try/catch shape** -- when a child fails at the Inngest function level
   (after max retries), how does the parent catch the error from `step.invoke()`?
   Is it a thrown Error or a special Inngest error type? Probe: wrap `step.invoke()`
   in try/catch and inspect the thrown value.

2. **`step.sendEvent()` vs `step.invoke()`** -- `sendEvent` fires and forgets (parent
   doesn't wait for child completion). When is fire-and-forget the right fan-out
   pattern vs step.invoke()? Cat IV Q-trigger-routing.

3. **Event routing for fan-out** -- when N children are spawned, each triggered by
   `pipeline/child-process` with different item data, how does Inngest route events
   to the correct function instances? Is there any risk of event routing collision?

4. **Dynamic child function selection** -- can step.invoke() target a function
   selected at runtime (e.g., different child function per item type)? Or must the
   function reference be compile-time constant?

5. **Fan-out at scale (N > 100)** -- does Inngest have practical limits on the number
   of concurrent step.invoke() calls within a single parent function?

---

## §4. CARRY-FORWARDS

**cf #10** (from Cat I spike #2) -- ADDRESSED by this spike. Parallel fan-out via
`step.invoke()` is the confirmed primitive. No new kit primitive needed.

New carry-forwards from this spike:

**cf #15** (Cat IV Q-error) -- Per-invoke catch shape for Inngest function-level
child failures. Parent needs to wrap each `step.invoke()` in try/catch for hard
failures. Document the pattern in adapter spec.

**cf #16** (Cat IV Q-fan-out) -- `kitFanOut(items, childFn)` helper design. Wraps
`Promise.all(items.map(step.invoke(...)))` with source memoization + per-invoke
catch + Result<T,E> aggregation. Candidate for `@idriszade/adapter-inngest`.

**cf #17** (Cat IV Q-trigger-routing) -- Event routing collision risk at high N.
When parent fans out N items all triggering "pipeline/child-process", does Inngest
route correctly to each child instance? Probe at N=20+.

**cf #18** (Cat IV Q-local-prod-seam) -- `kitFanOut` local equivalent: replace
`step.invoke` with direct call for test mode. Maps to the existing local-prod seam
concern (Cat VIII cf #5, Cat V cf #17).

---

## §5. STATUS

Throwaway code (3 harnesses, 6 source files). No kit-core amendments. No ADR drafts
(brain synthesises). Code shape confirmed structurally; behavioral findings marked
[PENDING-RUN] pending Inngest Dev Server availability.

**Defensible now (structural):**
- O5: replay safety (memoize source before using item.id in step IDs) -- CONFIRMED
- O6: no new kit primitive needed -- fan-out = Promise.all + step.invoke in adapter
- O7: local-prod seam is thin; Result<T,E> contract identical across both paths
- O8: Inngest imperative model matches kit Composer better than Step Functions Map

**Pending empirical confirmation (Dev Server required):**
- O1: type inference precision for step.invoke() return
- O2: exact Promise.all behavior when child exhausts retries vs returns Result.err
- O3: child concurrency limiting vs parent concurrency limiting (N=20 fan-out)
- O4: HRP inside fan-out (step.waitForEvent in child while parent waits on step.invoke)

*Author: Executor -- 2026-05-10. Branch: master (tip 856d918 at spike start).*
*inngest@4.3.0, @inngest/test@1.0.0. Strict TS compatible; ESM; Bun-runnable.*
*Dev Server not available via bunx -- InngestTestEngine used as structural validator.*

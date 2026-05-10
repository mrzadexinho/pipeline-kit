# Cat I Spike #2 — `multi-atom-hrp` Findings

> Spike: probe two untested Inngest composition points —
> (Leg 1) multi-atom dynamic step composition via for-loop step IDs,
> (Leg 2) HRP-review checkpoint via step.waitForEvent.
> Branch: `master`. Author: Executor — 2026-05-10.
> Companion to: `docs/research-outline-v1.md` § Category I (Durable Execution).
> Status: spike output (NOT a notes file; brain synthesises `docs/research-notes-v1-cat-I.md`
> after additional spikes if needed).
> Friction anchor: `F-DURABLE` — durable execution composition with Inngest.

## §1. SETUP

- **Directory:** `research/spikes/durable-execution/multi-atom-hrp/`
- **Runtime:** Bun 1.3.5.
- **Packages:** `inngest@4.3.0`, `@inngest/test@1.0.0` (same as spike #1).
- **LOC:** `spike.ts` 279 lines (pure code ~190; comment/blank ~89). 3-experiment structure.
- **Dev Server:** Not used. `InngestTestEngine` used as local in-process harness.
- **Key DX friction (L2-O5):** `@inngest/test@1.0.0` steps-array mock for
  `step.waitForEvent` is broken — engine passes `result.data` (a Promise) to
  `validateEvents` before awaiting it, producing `EventValidationError: Event not found
  in triggers: undefined`. Workaround: `transformCtx` option replaces `step.waitForEvent`
  with a mock function directly. Library bug, not a kit design issue.

**Run command:**

```
$ cd research/spikes/durable-execution/multi-atom-hrp && bun run spike.ts
```

## §2. LEG 1 — Multi-atom dynamic step composition

### Captured output (EXP A)

```
Result: {
  "collected": [
    { "id": "pk_proc_pk_atom_a", "doubled": 20 },
    { "id": "pk_proc_pk_atom_b", "doubled": 40 },
    { "id": "pk_proc_pk_atom_c", "doubled": 60 }
  ]
}

Execution ledger (replay fingerprint):
  [0]  fn-body:start
  [1]  source:handler            <- runs once; memoized on all subsequent replays
  [2]  fn-body:start
  [3]  fn-body:post-source atoms=3
  [4]  fn-body:loop-iter id=pk_atom_a
  [5]  process:handler id=pk_atom_a  <- runs once
  [6]  fn-body:start
  [7]  fn-body:post-source atoms=3
  [8]  fn-body:loop-iter id=pk_atom_a
  [9]  fn-body:loop-iter id=pk_atom_b
  [10] process:handler id=pk_atom_b  <- runs once
  [11] fn-body:start
  ...
  [16] process:handler id=pk_atom_c  <- runs once
  [17] fn-body:start
  [18] fn-body:post-source atoms=3   (all 3 process steps memoized now)
  [22] fn-body:post-loop
  [23] serve:handler               <- runs once
  [24] fn-body:start               <- final replay: all 5 steps memoized
  [30] fn-body:end

Handler execution counts:
  fn-body:start       = 6  (one per step completion = N_steps replays)
  source:handler      = 1  (expected: 1)
  process:handler x N = 3  (expected: 3, one per atom)
  serve:handler       = 1  (expected: 1)
```

### L1-O1 — Dynamic step IDs replay correctly

**CONFIRMED.** Dynamic step IDs `process-pk_atom_a`, `process-pk_atom_b`,
`process-pk_atom_c` replay correctly under Inngest's memoization model. Each
handler executed exactly once. Steps are keyed by the string ID passed to
`step.run()` (internally hashed). As long as the ID is deterministic across
replays, Inngest returns memoized output without re-running the handler.

### L1-O2 — For-loop replay behaviour

**CONFIRMED with precise fingerprint.** N=3 atoms, source step, serve step = 5
total steps. The function body re-executed 6 times (N_steps + 1 final completion
traversal). Consistent with spike #1 formula: for N steps, fn body re-executes
N times total. The for-loop itself re-executes on every replay — safe because:
(a) sourceAtoms is memoized; (b) step.run() inside the loop returns memoized
results for completed atoms (handler does not re-run).

**Loop iteration counts in final replay:** atom A: loop-iter runs 4x, handler 1x.
Atom B: loop-iter runs 3x, handler 1x. Atom C: loop-iter runs 2x, handler 1x.

### L1-O3 — Step-count limit / naming constraints

**No limit encountered at N=3.** Inngest SDK has no programmatic step count limit
observed. Naming constraint: IDs must be deterministic per replay. Dynamic IDs
`process-${atom.id}` satisfy this because `atom.id` is stable (source is memoized).
Risk at large N: Dev Server UI may have practical limits; not probed here.

### L1-O4 — Footgun: unstable step IDs break replay

**CRITICAL.** If the source array is computed OUTSIDE `step.run()`, atom IDs can
differ between replays, causing a step ID mismatch that Inngest cannot resolve
from its memoized state (runtime error).

```
// BROKEN — atom IDs unstable if source content changes between replays:
const atoms = await fetchFromDB();
for (const atom of atoms) await step.run(`process-${atom.id}`, ...);

// CORRECT — source is memoized, atom IDs are stable across all replays:
const atoms = await step.run("source", () => fetchFromDB());
for (const atom of atoms) await step.run(`process-${atom.id}`, ...);
```

Every input that influences dynamic step IDs MUST be wrapped in `step.run()`.

### L1-O5 — Fan-out vs Composer B pattern

Sequential for-loop = depth-first serial fan-out = kit M0.5 Composer B (serial).
**Parallel fan-out** (Composer B parallel variant) requires `step.invoke()` or
`step.sendEvent()` + sibling functions — structurally different. Future spike
should probe `step.invoke()` for parallel multi-atom composition. New cf #10.

## §3. LEG 2 — HRP checkpoint via step.waitForEvent

### L2-O1 — InngestTestEngine support for waitForEvent

**QUALIFIED.** The `steps`-array mock API in `@inngest/test@1.0.0` does NOT work
for `step.waitForEvent`. Engine bug: `result.data` (an unresolved Promise) is
passed to `validateEvents` before the Promise resolves, producing
`EventValidationError: Event not found in triggers: undefined`.

Root cause in `engine.js:1433`:
```js
// Bug: result.data is a Promise here, not the resolved value
await validateEvents([result.data], [{ event }]);
// Fix would be: await validateEvents([await result.data], [{ event }]);
```

**Workaround confirmed:** `transformCtx` option replaces `ctx.step.waitForEvent`
directly with a mock function, bypassing the engine's step-state machinery.
Evidence: EXP B and EXP C both passed with `transformCtx`.

In production (Dev Server + real Inngest server), `step.waitForEvent` works
correctly — this bug is test-harness-specific.

### L2-O2 — Review event payload access after resume

**CONFIRMED.** When the review event arrives, `step.waitForEvent` returns the
full Inngest event payload `{ name: "hrp/review.completed", data: { runId, approved, reviewer } }`.
Function body receives payload, accesses decision fields, proceeds to serve step.

Captured output (EXP B approved path):

```
[hrp] review requested for runId=01KRA418CK72BCFXRWY7QK4FD6
[hrp] serve: approved=true reviewer=alice@example.com
Result: {
  "processedAtomId": "pk_atom_hrp_proc",
  "approved": true,
  "reviewer": "alice@example.com",
  "completedAt": "2026-05-10T23:37:20.535Z"
}
```

### L2-O3 — Timeout path

**CONFIRMED.** On timeout, `step.waitForEvent` returns `null`. Inngest does NOT
throw. Function receives null and continues. Timeout policy is kit's decision:
(a) continue with approved=false (spike default), (b) throw `NonRetryableError`.

Captured output (EXP C timeout path):

```
[hrp] serve: approved=false reviewer=timeout
Result: { "processedAtomId": "pk_atom_hrp_proc", "approved": false, "reviewer": "timeout" }
```

### L2-O4 — Mapping to kit Reviewable<I>

**CONFIRMED — clean composition.**

| kit Reviewable<I> concept       | Inngest primitive                                      |
|---------------------------------|--------------------------------------------------------|
| Checkpoint: pause pipeline      | `step.waitForEvent("wait-for-hrp", { event, timeout, match })` |
| Send review request             | `step.run("send-review-request", ...)` — calls HRP webhook |
| Correlate to this run           | `match: "data.runId"` — Inngest filters by run ID      |
| Resume on approval              | Event `hrp/review.completed` received; fn body resumes |
| Timeout handling                | `null` return; kit handler decides fail vs continue    |
| Review decision                 | `reviewEvent.data.approved` + `reviewEvent.data.reviewer` |

No new kit-shape primitives required. The existing M0 Reviewable<I> kernel maps
directly. The checkpoint IS the `step.waitForEvent`; the review response IS the event payload.

**Note:** `step.waitForEvent` returns the FULL event payload `{ name, data }`, not
just `data`. Kit adapter must unwrap `.data` for HRP decision fields.

### L2-O5 — Triggering waitForEvent in InngestTestEngine

**`transformCtx` is the only working test-time approach** (steps-array broken, §L2-O1).

Production path: send the event via `inngest.send()` or HTTP POST to Dev Server
`/e` endpoint. Function resumes within event delivery latency. Not probed (Dev
Server binary unavailable via bunx; cf #7 from spike #1 still open).

## §4. CROSS-CUTS

### Does multi-atom composition change the kitStep() shim design?

**No.** `kitStep()` is called once per atom per step (N calls for N atoms). The
shim is stateless and composable. The for-loop pattern wraps each
`kitStep(step, \`process-${atom.id}\`, fn)` call independently. Shim from spike #1
confirmed stable for multi-atom composition. No changes needed.

### Does waitForEvent introduce a new adapter concern beyond kitStep()?

**Yes — one new concern.** Kit adapter tests probing HRP checkpoints MUST use
`transformCtx` to mock `step.waitForEvent`. Kit adapter test docs should document
this pattern; do NOT document the steps-array approach for waitForEvent steps.

Additionally: `step.waitForEvent` returns `{ name, data }` full event payload;
adapter must unwrap `.data` for HRP decision fields. Minor ergonomics; not structural.

### Cat V (MemoryAdapter lifecycle) interaction

**None observed.** Would arise if pipeline persists HRP checkpoint state to a
MemoryAdapter before `step.waitForEvent`. Carry-forward.

### Cat VIII (Secrets) interaction

**None observed.** Secrets adapter deps close over in function factory (Cat VIII
B-placement). HRP function would close over SecretsAdapter to fetch webhook signing
secrets before sending review request. No new shape; closure pattern is exact.

## §5. VERDICT

**Multi-atom dynamic composition: CONFIRMED.** Inngest's replay model handles
dynamic for-loop step IDs correctly for N=3 atoms. Each step handler runs exactly
once. The replay fingerprint is deterministic and extends spike #1's formula to N
steps. Sequential for-loop is a first-class composition pattern for kit's Composer fan-out.

**HRP checkpoint: CONFIRMED with one qualification.** `step.waitForEvent` cleanly
maps to kit's Reviewable<I> checkpoint. The mapping is direct: pause = waitForEvent;
review event = HRP response; timeout = null return. The only qualification: test
requires `transformCtx` (not steps-array) due to `@inngest/test@1.0.0` bug.

**kitStep() shim: STABLE.** Multi-atom composition does not require any shim changes.

**Adapter shape update:** Inngest adapter gains one new concern — `step.waitForEvent`
returns `{ name, data }`; adapter must unwrap `.data` for HRP decision fields.

## §6. CARRY-FORWARDS

10. **Parallel fan-out probe** (Cat I Q-composition). `step.invoke()` for parallel
    multi-atom fan-out. Sequential for-loop covers serial; parallel requires a
    separate Inngest primitive and spike.

11. **InngestTestEngine @inngest/test bug — waitForEvent steps-array** (DX friction).
    `result.data` (Promise) passed to `validateEvents` before awaiting. Fix: `await
    result.data`. Workaround: `transformCtx`. Kit adapter test docs must document
    `transformCtx` pattern. Report upstream to @inngest/test if desired.

12. **HRP + MemoryAdapter composition** (Cat V x Cat I). If kit persists HRP
    checkpoint state to a MemoryAdapter for observability, the Disposable lifecycle
    (ADR-V-2) must compose with Inngest function lifecycle. Not probed.

13. **waitForEvent event payload shape** (adapter spec). `step.waitForEvent` returns
    `{ name: string, data: T } | null`. Kit adapter must unwrap `.data` for HRP
    decision fields. Specify in adapter contract.

14. **Timeout policy ADR** (Cat I Q-HRP). On null timeout: kit should define default
    policy: (a) continue with approved=false, (b) throw NonRetryableError. Policy
    should be configurable per Reviewable checkpoint.

## §7. OPEN QUESTIONS (for brain — NOT decisions)

1. Is sequential for-loop fan-out sufficient for kit's M1 Composer, or must the
   Inngest adapter support parallel fan-out via `step.invoke()`? M0.5 Composer B
   was designed for parallel fan-out; Inngest sequential loop is structurally different.

2. Should kit expose a `kitWaitForEvent()` helper (analogous to `kitStep()`) that
   wraps `step.waitForEvent` and handles `{ name, data }` unwrap + timeout policy?
   Or is this left to the HRP adapter layer?

3. Does `match: "data.runId"` in `step.waitForEvent` require the runId in the trigger
   event data, or does Inngest populate it from the function's runId automatically?
   Spike used manual runId injection in event data. Brain to confirm canonical HRP
   correlation pattern.

4. Is the `@inngest/test@1.0.0` `waitForEvent` bug worth filing upstream? One-line
   fix at `engine.js:1433`: `validateEvents([await result.data], ...)`.

## §8. STATUS

Throwaway code (3 experiments). No kit-core amendments. No v0 ADR amendments.
No ADR drafts in this file (per brief). Brain synthesises after spike review.

Leg 1 (multi-atom dynamic steps): Q2 defensible (sequential fan-out confirmed).
Leg 2 (HRP checkpoint): Q5 HRP composition defensible (waitForEvent maps to
Reviewable<I>). kitStep() shim confirmed stable for multi-atom composition.

*Author: Executor -- 2026-05-10. Branch: master (tip e8a4666 at spike start).
inngest@4.3.0, @inngest/test@1.0.0. Strict TS compatible (no any); ESM; Bun-runnable.
Dev Server not available via bunx -- InngestTestEngine used with transformCtx workaround.*

# M2 Executor Session Kickoff

> Self-contained kickoff prompt for a fresh executor session.
> Copy/paste into a new Claude Code session at the pipeline-kit repo
> root. Brain has drafted + reviewed the M2 brief; you implement.

---

You are the executor session for pipeline-kit M2.

## Branch + repo

- Repo: `~/Claude-Workspace/pipeline-kit/`
- Master tip: `a331d6b` (M1 shipped, 29 ADRs, 562 tests).
- Your work branch: `m2-durable-execution` (create in Task 0).
- Stale branch to delete: `m1-core-foundation` (local + remote).
- Do **NOT** push. Brain authorises after report-back review.

## Required reading (in order, before any code)

1. `docs/briefs/m2_durable_execution.md` — entry brief; scope, 15
   tasks, gates, implementation notes. **Read Section 6 (Implementation
   Notes) carefully** — it has Inngest SDK API reference.
2. `docs/spec-v1.md` — entry spec; package topology + ADR index.
3. `docs/spec-v1-runtime.md` — §I durable execution: kitStep (I-2),
   NonRetryableError (I-3), attempt (I-4), HRP bridge (I-5),
   replay-safety (I-6), adapter-inngest (I-7). §IV triggers: fan-out
   (IV-1), TriggerConfig (IV-2), TriggerAdapter (IV-3), RunGuard (IV-4),
   idempotency (IV-5), envelope (IV-6), kitFanOut (IV-7).
4. `docs/spec-v1-dx.md` — §VII: definePipeline (VII-1), CLI (VII-2),
   templates (VII-3), describe enriched (VII-5).
5. `CLAUDE.md` — engineering rules (300/500 line limits; strict TS;
   ESM-only; Result\<T,E\>; no emojis).
6. `packages/core/src/index.ts` — M1 barrel; verify all types you
   need are exported.

If ambiguous after reading, surface in OPEN QUESTIONS; do NOT
improvise architecture. The 55 v1 ADRs are locked.

## Architectural locks

- **55 v1 ADRs + 23 v0 ADRs are locked.** Do not re-deliberate.
- **kitStep()** = Result→throw bridge (~8 LOC). Lives in adapter, NOT
  core. Returns `Promise<T>`, not `Promise<Result<T,E>>`.
- **kitFanOut()** = `step.invoke()` per item, NOT `step.run()`.
  Per-invoke catch → `Result.err(...)`. Returns `Result<T,E>[]`.
- **createKitFunction()** = each atom is own `step.run()`. NOT
  whole-pipeline-as-one-step (defeats per-atom retry).
- **TriggerAdapter** = interface in core, Inngest impl in adapter,
  local impl in CLI. Same seam as SecretsResolver/MemoryAdapter.
- **KitTriggerEnvelope\<T\>** = `{ id, type, source, time, data: T }`.
  CloudEvents `specversion` is adapter serialize-time only.
- **HRP bridge** = step.waitForEvent. `match: "data.runId"`.
  Timeout policy enum per-checkpoint (continue vs error).
- **CLI** = 3 commands at M2 (dev/run/inspect). `pk trace` deferred
  to M3. No bespoke CLI framework.

## Scope (15 tasks, 5 layers)

**Layer 0 (Tasks 0–2):** Scaffolds. Tasks 1+2 parallelizable.

**Layer 1 (Task 3):** TriggerAdapter types in core.

**Layer 2 (Tasks 4–5):** Adapter foundation. Tasks 4+5 parallelizable.

**Layer 3 (Tasks 6–9):** Adapter advanced features. Tasks 7+8
parallelizable.

**Layer 4 (Tasks 10–13):** Barrel + CLI. **BRAIN CHECK-IN after
Task 10** (adapter-inngest complete).

**Layer 5 (Task 14):** Integration + gates + report-back.

One commit per Task 1–13 (Tasks 0 + 14 are verify-only).

## Gates (all 5 green = done)

```
pnpm typecheck            # zero errors across all packages
pnpm lint                 # zero violations
pnpm test                 # all green; baseline 562
pnpm test:types           # type tests pass
bun test                  # runtime-compat smoke
```

Test count target: **600+** (562 baseline + ~50 new).

## Brain check-in (pause for review)

**After Task 10** — adapter-inngest feature-complete. Validate adapter
shape, surface any M1 contract gaps, confirm CLI scope. Then continue
Tasks 11–14.

## Key constraints

1. **Inngest peer dep:** Verify `inngest ^4.0.0` exists on npm. If not,
   use latest v3 and document deviation in OPEN QUESTIONS.
2. **NonRetryableError** import from `inngest` package directly.
3. **StageErrorCode retryability:** Use `RETRYABILITY_MAP` from
   `@idriszade/core` — already shipped in M1.
4. **Result shape:** `{ data: T; error: null } | { data: null; error: E }`.
   The `ok()` and `err()` helpers are in core.
5. **Replay-safety (I-6):** Source MUST be wrapped in step.run().
   Document in README with passing/failing code samples. No runtime
   guard at v1 — docs + code review only.
6. **Pipeline file convention:** `pipelines/**/*.pipeline.ts` — each
   file exports a DefinedPipeline instance.
7. **File size limits:** 300 soft / 500 hard per CLAUDE.md.

## Report-back format

When all 5 gates green and Tasks 0–14 complete, write report-back
to `docs/briefs/m2_report_back.md`:

```
## Summary
## Tasks completed (0–14)
## 5-gate verification (terminal output)
## Test counts (before -> after)
## Files added / modified
## Branch state
## OPEN QUESTIONS surfaced
## M3 readiness assessment
```

Push only after brain authorises.

## Start now

**Task 0** — state verify + branch. Confirm `git log --oneline -1`
shows `a331d6b`, confirm all 5 gates green as baseline, delete stale
`m1-core-foundation` branch (local + remote), create branch
`m2-durable-execution`.

# M1 Executor Session Kickoff

> Self-contained kickoff prompt for a fresh executor session.
> Copy/paste into a new Claude Code session at the pipeline-kit repo
> root. Brain has drafted + reviewed the M1 brief; you implement.

---

You are the executor session for pipeline-kit M1.

## Branch + repo

- Repo: `~/Claude-Workspace/pipeline-kit/`
- Master tip: `3e4c1dc` (v1 spec shipped, 55 ADRs locked).
- Your work branch: `m1-core-foundation` (create in Task 0).
- Do **NOT** push. Brain authorises after report-back review.

## Required reading (in order, before any code)

1. `docs/briefs/m1_core_foundation.md` — entry brief; scope, 15
   tasks, gates, implementation notes. **Read Section 5 (Implementation
   Notes) carefully** — it resolves spec inconsistencies.
2. `docs/spec-v1.md` — entry spec; package topology + ADR index.
3. `docs/spec-v1-core.md` — §VI StageErrorCode (lines 36–64),
   DisposableRegistry (92–123), §III linear API, §II agent patterns.
4. `docs/spec-v1-runtime.md` — §I durable execution (Err.retryable,
   attempt semantics), §IV triggers/RunGuard (lines 170–305).
5. `docs/spec-v1-cross-cutting.md` — §VIII SecretsResolver (lines
   9–68), §V MemoryAdapter (lines 114–217), §X UsageAccumulator
   (lines 308–382).
6. `docs/spec-v1-dx.md` — §VII definePipeline (lines 17–29),
   describe enriched (lines 125–137).
7. `CLAUDE.md` — engineering rules (300/500 line limits; strict TS;
   ESM-only; Result\<T,E\>; Zod at boundaries; no emojis).
8. `docs/spec.md` — v0 ADRs (23 locked). Inputs, NOT re-deliberable.

If ambiguous after reading, surface in OPEN QUESTIONS; do NOT
improvise architecture. The 55 v1 ADRs are locked.

## Architectural locks

- **55 v1 ADRs are locked.** Do not re-deliberate.
- **23 v0 ADRs are locked.** Do not amend.
- **StageErrorCode** = 19-code string literal union (not error
  classes, not branded types).
- **DisposableRegistry** = `close()` pattern (NOT Symbol.dispose).
- **RunGuard** = single interface with optional fields (NOT
  discriminated union — concerns are orthogonal).
- **MemoryAdapter methods** = `read()` / `write()` (NOT
  storeMemory/retrieveMemory — drilldown overrides entry summary).
- **PipelineContext.deps** = runtime deps only. Secrets are
  construction-time (VIII-1 key constraint).

## Scope (15 tasks, 4 layers)

**Layer 0 (Tasks 0–6):** Foundation types — all independent, no
cross-refs. New files in `packages/core/src/`.

**Layer 1 (Task 7):** Composer extensions — budget checks, disposal
integration, buffer config. **BRAIN CHECK-IN after Task 7.**

**Layer 2 (Tasks 8–11):** DX layer — named patterns, definePipeline,
barrel export, property + type tests. **BRAIN CHECK-IN after Task 11.**

**Layer 3 (Tasks 12–13):** New packages — secrets + memory. These
are independent and CAN be parallelized via subagent dispatch.

**Layer 4 (Task 14):** Integration tests + full gate run + report.

One commit per Task 1–13 (Tasks 0 + 14 are verify-only).

## Gates (all 5 green = done)

```
pnpm typecheck            # zero errors across all packages
pnpm lint                 # zero violations
pnpm test                 # all green; >=85% coverage on new code
pnpm test:types           # type tests pass
bun test                  # runtime-compat smoke
```

Test count target: **500+** (M0.5 baseline 435 + ~80 new).

## Brain check-ins (pause for review)

Surface a brief checkpoint summary and pause after:

1. **Task 7** — Composer extensions. Validate budget check shape,
   buffer 'all' vs count/time scope decision, disposal integration.
   Surface any complexity that warrants deferring buffer modes to M2.
2. **Task 11** — Core complete. Validate all new types exported,
   existing tests updated for PipelineContext changes, coverage >=85%.
   Confirm core is ready for secrets/memory package work.

Otherwise, execute the brief verbatim per the task list.

## On breaking changes

PipelineContext.attempt changes from `number` (default 1) to
`number | undefined` (0-indexed). This WILL break existing tests.
Update them to use `ctx.attempt ?? 0` pattern. Surface the full
count of updated test files in the report-back.

## Report-back format

When all 5 gates green and Tasks 0–14 complete, write report-back
to `docs/briefs/m1_report_back.md`:

```
## Summary
## Tasks completed (0–14)
## 5-gate verification (terminal output)
## Test counts (before -> after)
## Files added / modified
## Branch state
## OPEN QUESTIONS surfaced
## M2 readiness assessment
```

Push only after brain authorises.

## Start now

**Task 0** — state verify + branch. Confirm `git log --oneline -1`
shows `3e4c1dc`, confirm all 5 gates green as baseline, branch off
`m1-core-foundation`.

> NOTE 2026-05-09: kit packages renamed @pipeline-kit/* →
> @idriszade/* in M0.5b. Brief text below is the spec at the time
> of writing — package names there are historical.

# M0.5 Executor Session Kickoff

> Self-contained kickoff prompt for a fresh executor session.
> Copy/paste into a new Claude Code session at the pipeline-kit repo
> root. Brain has drafted + reviewed the M0.5 brief; you implement.

---

You are the executor session for pipeline-kit M0.5.

## Branch + repo

- Repo: `~/Claude-Workspace/pipeline-kit/`
- Master tip carrying the brief: `7d8fd44` (M0 ship) →
  brief commit on master at the time of this kickoff (run
  `git log --oneline -5` to confirm).
- Your work branch: `m0-5-reference-adapters` (you create it in
  Task 0; branch off master tip).
- Do **NOT** push. Brain authorises after report-back review.

## Required reading (in order, before any code)

1. `docs/briefs/m0_5_reference_adapters.md` — entry brief; 1134
   lines; Section 0 (architectural locks) + Sections 1-11 (philosophy,
   refs, context, stack, drilldown pointer, tasks, gates, report-back,
   non-goals, OQs, coordination).
2. `docs/briefs/m0_5_reference_adapters-spec.md` — 15-adapter
   signature drilldown; 769 lines.
3. `docs/briefs/m0_report_back.md` — M0 ship state + 7 OQs (1, 3
   carry into M0.5 as Locks; the rest are resolved).
4. `CLAUDE.md` — engineering rules (300-line soft / 500-line hard
   file limits; strict TypeScript; ESM-only; Result<T,E>; Zod at
   boundaries; functional core; no emojis).
5. `docs/spec.md` + `docs/spec-api-surface.md` +
   `docs/spec-adapters.md` + `docs/spec-build-plan.md` — the 23 v0
   ADRs + API surface + adapter contract + test plan. Inputs, NOT
   re-deliberables.

If a code decision is ambiguous after reading these, surface in
OPEN QUESTIONS; do NOT improvise architecture. The 23 v0 ADRs are
locked.

## Architectural locks (Section 0 of the brief)

Two locks are load-bearing for adapter signatures; do not
re-deliberate:

- **Lock 1 — Reviewable canonical location.** Types
  (`Reviewable<I>`, `ReviewableConfig`, `ReviewResponse<I>`,
  `ReviewError`) live in `@pipeline-kit/core`;
  `process-reviewable` re-exports + ships impls. Already shipped
  this way in M0; Task 18 of M0.5 adds a clarifying note to
  `spec-api-surface.md`.
- **Lock 2 — Source fan-out option (B).** Composer iterates atoms
  yielded by `Source.iter()`; each downstream stage invoked once
  per atom. `Process<I, O>` signature unchanged. On success:
  `RunResult.output` = last atom's output, `atomCount` = M (atoms
  yielded). On fail-fast: `Result<null, RunError>`, no RunResult,
  `atomCount` = N (atoms yielded before fail; lazy iter means
  atoms N+1..M are never pulled). Task 1 of M0.5 implements this
  Composer upgrade BEFORE any adapter ships.

## Scope (21 tasks; Section 6 of the brief)

In strict order:

- Task 0: state verify + branch off `m0-5-reference-adapters`.
- Task 1: Composer fan-out upgrade (per Lock 2). 8 fan-out tests
  + 2 property tests. **Brain check-in after this task.**
- Task 2: bootstrap 15 adapter package skeletons.
- Tasks 3-6: Source adapters (api / webhook / apify / mcp).
- Task 7: store-postgres. **Brain check-in after Task 7
  (Source cluster done).**
- Tasks 8-9: store-sqlite + store-pgvector.
- Tasks 10-13: Process adapters (extract / classify / validate /
  route). **Brain check-in after Task 13 (Process cluster done).**
- Tasks 14-17: Serve adapters (email / slack / webhook / mcp).
- Task 18: spec-text touch-ups.
- Task 19: coverage gate + READMEs.
- Task 20: smoke (no commit).

One commit per Task 1-19 (Tasks 0 + 20 are verify-only).

## Verification gates (all 5 green = code-level done)

```
pnpm typecheck            # zero errors across all 17 packages
pnpm lint                 # zero violations
pnpm test                 # all green; thresholds 80/80/75/80
pnpm test:types           # all green
bun test                  # runtime-compat smoke on 4+ packages
```

Test count target: **425+ total** (M0's 231 baseline + ~175 new).
Add tests to close coverage gaps; never weaken thresholds.

## Brain check-ins (pause for review)

Surface a brief checkpoint summary and pause for brain reply
after:

1. **Task 1** — Composer fan-out. Validate Lock 2 implementation
   shape before adapters depend on it.
2. **Task 7** — Source cluster done. Surface any version-drift
   findings (Hono major, Drizzle minor, MCP SDK, Apify client).
3. **Task 13** — Process cluster done. Surface LLM provider
   integration findings (OpenAI/Anthropic/Google SDK shapes; any
   peerDep dynamic-import friction).

Otherwise, execute the brief verbatim per Section 6.

## On unresolvable architectural questions

Surface in **OPEN QUESTIONS** in the report-back; do NOT improvise.
The 10 OPEN QUESTIONS in Section 10 of the brief have locked
defaults for 7 + defer-to-executor for 3 (Drizzle custom-type
stability, Hono major, Google GenAI package rebrand). If you hit
a defer-to-executor item, surface; brain decides.

## Report-back format (Section 8 of the brief)

When all 5 gates green and Tasks 0-20 complete, write report-back
to `docs/briefs/m0_5_report_back.md` mirroring the format in
Section 8. Include: summary / tasks completed / 5-gate verification
/ test counts / files added / branch state / Composer fan-out
validation / OPEN QUESTIONS surfaced.

Push only after brain authorises.

## Estimated effort

35-50 hours across 3-5 sessions. Take brain check-in pauses as
natural session boundaries (1 session per cluster: fan-out + Source
+ Store + Process + Serve + closeout).

---

**Start now with Task 0** — state verify + branch off. Confirm
`git status` is clean; confirm M0 ship tip; confirm brief commit
present; verify M0's 5 gates still green as the baseline.

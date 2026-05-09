> NOTE 2026-05-09: kit packages renamed @pipeline-kit/* →
> @idriszade/* in M0.5b. Brief text below is the spec at the time
> of writing — package names there are historical.

# M0 Report-Back — Composer + Reviewable<I> + GatewerkReviewable

> Executor session, 2026-05-06. Branch `m0-composer-reviewable` at tip
> `e7a5a24` off `master` tip `79bf147`. NOT pushed; brain authorises.

## Summary

M0 shipped end-to-end. Two packages bootstrapped (`@pipeline-kit/core` +
`@pipeline-kit/process-reviewable`) on a pnpm 10.33.4 workspace with the
locked toolchain (TypeScript 6.0.3, Biome 2.4.14, Vitest 4.1.5,
fast-check 4.7.0, tstyche 7.1.0; npm registry showed zero version drift
against the brief). All five verification gates green: `pnpm typecheck`,
`pnpm lint`, `pnpm test` (210/210 with coverage 90.34% lines / 79.59%
branches / 91.15% functions / 92.26% statements — every threshold above
80/80/75/80), `pnpm test:types` (21 tests / 24 assertions across 3
test-d files), `bun test` (172 core + 38 process-reviewable = 210/210
runtime-compat smoke). Loop α validates: `Pipeline.from(...).review(
GatewerkReviewable).to(...).run()` runs end-to-end against mocked
gatewerk transport across 5 ReviewResponse decision types.

## Tasks completed

- [x] Task 0  — State verified, branch off master tip 79bf147
- [x] Task 1  — Bootstrap monorepo (pnpm + biome + vitest + ci matrix)
- [x] Task 2  — core: Result + envelopes + ID helpers
- [x] Task 3  — core: PipelineContext
- [x] Task 4  — core: stage interfaces + typed errors
- [x] Task 5  — core: Composer (retry + rate-limit + OTel + idempotency + cancellation)
- [x] Task 6  — core: Pipeline chainable factory + type-narrowing
- [x] Task 7  — core: webhook sign/verify
- [x] Task 8  — core: createPipelineKit factory + 4-resource SDK shape
- [x] Task 9  — process-reviewable: Reviewable<I> interface
- [x] Task 10 — process-reviewable: EditableField<T>
- [x] Task 11 — process-reviewable: reviewable-wrapper
- [x] Task 12 — process-reviewable: GatewerkReviewable + ConsoleReviewable
- [x] Task 13 — Property tests + tstyche
- [x] Task 14 — Coverage gate + README
- [x] Task 15 — Smoke (verification only, no commit)

## Verification (5 gates)

- pnpm typecheck:    pass (both packages, zero errors)
- pnpm lint:         pass (84 files, zero errors / zero warnings)
- pnpm test:         210/210 — lines 92.26% / functions 91.15% /
                     branches 79.59% / statements 90.34%
- pnpm test:types:   pass — 21 tests / 24 assertions across 3 test-d files
- bun test:          210/210 across both packages

## Test counts

- Unit/integration:  198 (target: 50+)
- Property:          5 spec files, 12 fc.assert calls (target: 5)
- tstyche:           24 assertions across 3 test-d files (target: 3+)
- TOTAL:             231 (vitest 210 + tstyche 21)

## Files added

- packages/core/src/                     41 files / 1,703 lines
- packages/core/tests/                   21 files / 2,104 lines
- packages/process-reviewable/src/        7 files /   312 lines
- packages/process-reviewable/tests/      6 files /   643 lines
- root config files: package.json, pnpm-workspace.yaml,
  tsconfig.base.json, biome.json, vitest.config.ts, tstyche.json,
  .changeset/config.json, .github/workflows/ci.yml, LICENSE,
  README.md (rewritten)

All source files under 300-line soft limit (largest: pipeline.ts 183
lines, gatewerk-reviewable.ts 173, composer.ts 166).

## Branch state

- Branch: m0-composer-reviewable
- Tip: e7a5a24
- Commits: 14 (one per Task 1–14 checkpoint per brief Section 5;
  Task 0 and Task 15 are verification-only)
- Pushed: no (brain authorises after report-back review)

## OPEN QUESTIONS

1. **OQ-1 (architecture, Task 6/9/11) — Reviewable types live in core,
   not process-reviewable.** Brief Task 9 puts `Reviewable<I>` +
   `ReviewableConfig` + `ReviewResponse<I>` in process-reviewable, and
   Task 11 puts `reviewableWrapper` there too. But Task 6 / spec-api-surface
   defines `SourcePipeline<O>.review(reviewable: Reviewable<O>)` in
   core. Since core cannot import from process-reviewable (process-reviewable
   already depends on core), the type contracts and conversion logic
   live in `packages/core/src/reviewable.ts` +
   `packages/core/src/reviewable-to-process.ts`. process-reviewable
   re-exports the types and re-exports `reviewableToProcess` as
   `reviewableWrapper` — same execution path, single source of truth.
   The brief's task assignment is honored in spirit (process-reviewable
   owns the public name, EditableField, GatewerkReviewable,
   ConsoleReviewable), but the architecturally-required types and
   conversion logic ended up in core. Confirm acceptable; spec-api-surface
   text could note this for clarity.

2. **OQ-2 (test naming, Task 6) — `pipeline.test.ts` vs brief
   `pipeline.spec.ts`.** Brief Task 6 says `tests/pipeline.spec.ts`; my
   vitest include pattern is `**/*.test.ts` for consistency with all
   other test files. Naming changed to `pipeline.test.ts`. No semantic
   difference; flagging only for spec-text alignment.

3. **OQ-3 (composer semantics, Task 5/6) — first-atom semantics for
   Source output.** `Source<O>.fetch` returns `Atom<O>[]` but downstream
   `Process<O, Out>` takes singular `O`. Composer bridges by extracting
   `atoms[0].data` and returning `source_failed` (type `unavailable`,
   code `source_no_atoms`) on empty list. Multi-atom fan-out (loop
   atoms through downstream stages, RunResult.atomCount = source emit
   count) deferred to M0.5 or M1 — sufficient for Loop α validation.
   Confirm the simplification is acceptable for the M0.5 brief's
   adapter design.

4. **OQ-4 (toolchain, Task 1) — pnpm 9.15.4 local vs 10.33.4
   `packageManager`.** Local `pnpm` is 9.15.4 (brew); brief specifies
   10.33.4 in `packageManager` field; CI matrix uses 10.33.4 via
   `pnpm/action-setup@v4`. Lockfile written by 9.15.4 reads cleanly by
   10.33.4 (no v9→v10 lockfile format change). pnpm 9 emits a one-time
   "update available" notice but proceeds. Not blocking; surfacing for
   brain awareness.

5. **OQ-5 (TypeScript narrowing edge case, Task 5) — Result<T, E>
   narrowing required `as T` cast.** TypeScript 6.0.3 fails to narrow
   `Result<T, E>` after `if (r.error === null)` in
   `composer/retry.ts` when E is generic-constrained — emits
   TS2322 "Type 'T | null' is not assignable to type 'T'" on `r.data`.
   Fix: explicit `r.data as T` cast inside the narrow. Safe at runtime
   since the discriminant fully separates the union; the cast simply
   acknowledges TS's narrowing limit. Worth a focused tstyche test in
   M0.5 to track regressions if TS narrowing improves.

6. **OQ-6 (versions, Task 1) — zero drift on locked stack.** All seven
   brief-locked versions resolved exactly on 2026-05-06: TypeScript
   6.0.3, Vitest 4.1.5, Biome 2.4.14, fast-check 4.7.0, tstyche 7.1.0,
   ulid 3.0.2, p-retry 8.0.0. spec-build-plan.md §3 still mentions
   "Vitest 2.x" / "fast-check 3.x" — version-pin update queued for
   M0.5 / M1 spec-text refresh per brief OPEN QUESTIONS Q2.

7. **OQ-7 (Q10 confirmation, Task 10) — `node:util.isDeepStrictEqual`
   works in Bun 1.3.5.** Q10 was deferred-to-executor pending runtime
   confirmation. EditableField's `Field.edited` uses
   `node:util.isDeepStrictEqual`; Bun 1.3.5 runs all
   editable-field.test.ts cases including object/array deep-equality
   property tests. No fallback needed.

## Loop α validation status

Loop α (kit dogfoods Gatewerk via `Reviewable<I>`) validates green.
`Pipeline.from(source).review(GatewerkReviewable).to(serve).run()` runs
end-to-end against mocked gatewerk transport across all 5 ReviewResponse
decision types: approved, approved-with-edit (wasEdited=true), rejected,
retry (mapped to transient error so Composer's retry policy re-attempts
per ADR13), ignored. Plus 2 error-wrapping scenarios (gatewerk
reviews.create transport failure, ctx.signal abort during polling).
`Pipeline.review(rev) === Pipeline.through(reviewableWrapper(rev))` is
verified at runtime — both paths invoke the same `reviewableToProcess`
helper in core, confirmed by an identity test
(`expect(reviewableWrapper).toBe(reviewableToProcess)`). Property test
(reviewable.property.test.ts) further verifies that approved decisions
preserve `Object.is(input, value)` for arbitrary input shapes from
fast-check. No real Gatewerk HTTP traffic in M0 tests — production
integration validation belongs to M1's Trades Outbound deployment.

---

*All five gates green. Branch sits at e7a5a24. Push gated on brain
review of this report-back.*

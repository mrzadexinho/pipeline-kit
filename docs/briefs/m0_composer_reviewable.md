> NOTE 2026-05-09: kit packages renamed @pipeline-kit/* →
> @idriszade/* in M0.5b. Brief text below is the spec at the time
> of writing — package names there are historical.

# Brief — M0 Composer + Reviewable<I> + GatewerkReviewable

> **Branch:** `m0-composer-reviewable`
> **Author (brain):** Idris's brain session, 2026-05-06
> **Estimated executor effort:** 8-12 hours (single session OK; 2 sessions
> cleaner with brain check-in between Tasks 8 and 9)
> **Status:** Ready for executor pickup. Branches off `master` (tip
> `44b5758` — Phase 2 spec drilldowns landed).
> **Predecessor:** Phase 2 spec lock (commit `44b5758`).

**Strategic context:** M0 is the smallest shippable kernel that validates
**Loop α** — the kit dogfoods Gatewerk by shipping `Reviewable<I>` as a
first-class primitive with `GatewerkReviewable` as its reference impl. Two
packages ship: `@pipeline-kit/core` (orchestration kernel) and
`@pipeline-kit/process-reviewable` (HRP gate adapters). The 15 other
reference adapters defer to **M0.5**; Trades Outbound to **M1**;
`Audited<I,O>` to **M2**.

**What's locked:** all 23 v0 ADRs + the API surface in
`spec-api-surface.md`. **Do NOT re-deliberate.** If a real architectural
question surfaces, surface it in OPEN QUESTIONS (Section 9); do NOT invent
new ADRs.

---

## 1. Engineering philosophy block

Read `CLAUDE.md` end-to-end before touching code. Hard rules (full text in
`CLAUDE.md`; condensed here):

- **300 lines soft / 500 lines hard** per file. Composer module needs early
  splits — budget for `composer/{retry,rate-limit,otel,idempotency,
  cancellation}.ts` rather than a single `composer.ts`.
- **Strict TypeScript.** `strict: true`, `noUncheckedIndexedAccess: true`,
  `noImplicitOverride: true`. Zero `any` in source; `unknown` at boundaries.
- **ESM only.** `"type": "module"`. Imports use `.js` suffix per ESM
  resolution.
- **Result<T, E> kit-wide** (per ADR4). No thrown errors crossing public
  stage boundary.
- **Zod 4 at every Source/Serve boundary** (per ADR6); use `safeParse`,
  never `parse`.
- **Functional core, imperative shell.** No `class` for behavior unless
  lifecycle demands it; Reviewable adapters are the lifecycle exception.
- **Comments only when WHY is non-obvious.** No "what" comments.
- **No emojis** in code, output, or commit messages.
- **Modern types only** — `string | undefined`, `Array<T>`, `Record<string,
  unknown>`. No legacy `Optional`-shaped wrappers.
- **`pnpm` only** for deps. Tests in `<package>/tests/` mirroring `src/`.

Verification gates (all five green before reporting back):

```
pnpm typecheck            # tsc --noEmit across all packages
pnpm lint                 # biome check
pnpm test                 # vitest run --coverage; thresholds 80/80/75/80
pnpm test:types           # tstyche on Pipeline chainable types
bun test                  # runtime-compat smoke on Bun 1.3+
```

**Read durable lessons before starting** — pipeline-kit memory:

- `feedback_spec_doc_discipline.md` — split docs >1500 / sub-files >500 lines
- `project_pipeline_kit_phase_2_complete.md` — Phase 2 context

And from family memory:
- `~/.claude/projects/-Users-zadexinho-Claude-Workspace-pursuit/memory/feedback_pydantic_boundary_coercion.md`
  — coerce/truncate/default at LLM boundary; never strict caps. Internalise
  philosophy now (M0.5's `extract-process` applies it).

---

## 2. References — pipeline-kit family mining rule

**Lift patterns, not code.** Do NOT add family repos to `tsconfig` paths or
copy source files.

### Lift from family

- **`~/Claude-Workspace/gatewerk/packages/sdk-ts/`** (locally available as
  `gatewerk@0.1.0`):
  - Resource-based SDK shape (`pk.pipelines.create` mirrors `gw.reviews.*`).
  - `createClient` factory + env-var fallback.
  - HMAC-SHA256 webhook verification with `crypto.timingSafeEqual` +
    Stripe-canon header (per ADR21).
  - Result<T, E> + Sentry-shape error envelope.
- **`~/Claude-Workspace/gatewerk/docs/research/ideas-to-steal.md`** —
  cross-reference catalog when implementation hits ambiguity.
- **`~/Claude-Workspace/pursuit/agents/tools/`** — adapter-folder shape
  inspiration for M0.5's 15 adapter packages (M0 only ships `core` +
  `process-reviewable`).

### NOT lift

- Gatewerk's HITL UI logic — kit composes HITL stations via `Reviewable<I>`,
  doesn't replace them.
- Gatewerk's API server / dashboard / DB schema — kit has no server.
- Pursuit's Python adapter implementations or mode-specific routing.
- Mediaflow's multi-tenant patterns.

### Required reading order (read-only inputs, before any code)

1. `docs/spec.md` (entry doc; 23 ADRs + reading map; 1510 lines).
2. `docs/spec-api-surface.md` (§1 — **the contract M0 implements**; ~225 lines).
3. `docs/spec-adapters.md` (§2 — only `reviewable-wrapper` (#12) ships in M0).
4. `docs/spec-build-plan.md` (§3 test plan + §4 roadmap + §5 deferred).
5. `CLAUDE.md` (engineering rules — already condensed in Section 1).

If a code decision is ambiguous after reading these five, surface in OPEN
QUESTIONS; do NOT improvise architecture.

---

## 3. Context — what M0 ships

### What's done (Phase 1 + Phase 2)

- **Phase 1** (commit `d780eec`): 58 sources / 10 categories / 1944 lines of
  research notes; 23 v0 ADRs scoped; 8 open questions answered.
- **Phase 2** (commits `4e74a85` + `44b5758`): 23 v0 ADRs locked +
  `spec-api-surface.md` + `spec-adapters.md` (16 adapters) +
  `spec-build-plan.md` (test plan, roadmap, deferred). Brain authority — no
  executor edits to spec.

### What M0 closes — Loop α validation

`Pipeline.from(...).review(GatewerkReviewable).to(...)` runs end-to-end
against a (mocked-transport) Gatewerk instance.

### `@pipeline-kit/core` — orchestration kernel

- `Result<T, E>` discriminated union (ADR4).
- `ResourceEnvelope` + `ErrorEnvelope` (ADR16; Sentry-shape).
- ULID-prefixed ID helpers `pk.ids.{run,atom,pipe,src,proc,serve,review,evt}()`
  (ADR16).
- `PipelineContext` interface + Composer-side construction (ADR5; **NO
  `child(overrides)`** per spec redline).
- Source / Store / Process / Serve interfaces — **signatures only, no impls**
  (ADR2 / ADR4 / ADR7; ADR9 for Serve `idempotencySupport` flag).
- `Pipeline.from(s).through(p).store(st).review(rev).to(srv)` chainable
  factory with type-narrowing (ADR12). `.review(rev)` is sugar over
  `.through(reviewableWrapper(rev))` — both call into the same execution path.
- Composer wrapper: retry via `p-retry` (ADR13; AWS canonical defaults),
  token-bucket rate-limit (ADR10), OTel hooks via `@opentelemetry/api`
  peerDep (ADR8), idempotency-key auto-generation + propagation (ADR9; **no
  cache shipped in core** per spec redline).
- Webhook helpers `pk.webhooks.{verify,sign}` with single-header
  `X-Pipeline-Kit-Signature: t=<unix>,v1=<hex>` Stripe canon (ADR17 + ADR21).
- SDK factory `createPipelineKit(config?)` mounting 4 resources:
  `pk.{pipelines,runs,atoms,webhooks}` (ADR23; **NO `pk.adapters`** per spec
  redline). M0 stubs `pipelines/runs/atoms` resources with
  `not_implemented` error (real backends ship in v2 cloud product); only
  `webhooks` is fully wired.

### `@pipeline-kit/process-reviewable` — HRP gate adapters

- `ReviewableConfig` + `ReviewResponse<I>` discriminated union +
  `Reviewable<I>` interface (ADR14; **list-of-responses return shape from
  day one**).
- `EditableField<T>` + `Field.{unedited,edited,rejected}` helpers (ADR19).
- `reviewable-wrapper` Process<I,I> adapter — the underlying primitive
  `.review()` sugar uses (per ADR12 + spec-adapters §2 #12).
- `GatewerkReviewable<I>` reference impl using `gatewerk` SDK as peerDep.
- `ConsoleReviewable<I>` stub for dev (no peerDeps).

### Tests targeted

**50+ unit/integration tests + 5 property tests + 3+ tstyche assertions.**

Property tests (per spec §3):
1. Reviewable preserves I shape on `decision: 'approved'`.
2. EditableField invariants (`unedited`/`edited`/`rejected`).
3. Composer idempotency-key propagation across stages.
4. Cancellation graceful (`AbortSignal` abort → `error.type === 'cancelled'`).
5. OTel parent/child span hierarchy.

---

## 4. Stack locked for M0

All versions resolved 2026-05-06 against npm. Executor verifies on `pnpm
install` and surfaces any drift.

### Runtime + tooling

| Tool | Version | Notes |
|---|---|---|
| Node | 20.x + 22.x LTS | CI matrix |
| Bun | 1.3.5+ | Third CI matrix entry; runtime-compat smoke |
| pnpm | 10.33.4 | `packageManager` field in root package.json |
| TypeScript | ^6.0.3 | strict + noUncheckedIndexedAccess + noImplicitOverride |
| Biome | ^2.4.14 | one-tool lint+format (ADR15) |

### Test stack

| Tool | Version | Notes |
|---|---|---|
| Vitest | ^4.1.5 | unit + integration |
| @vitest/coverage-v8 | matching 4.x | thresholds 80/80/75/80 |
| fast-check | ^4.7.0 | property tests |
| tstyche | ^7.1.0 | type-level tests on Pipeline chainable API |

> **Version-drift note:** spec text mentions "Vitest 2.x" / "fast-check 3.x".
> Latest stable on 2026-05-06 is Vitest 4.1.5 / fast-check 4.7.0. M0 uses
> latest stable per brain instruction "resolve concrete latest-stable
> versions during brief authoring". This is a **version-pin update, NOT an
> ADR15 re-deliberation**. Surface in OPEN QUESTIONS for spec-text update.

### `@pipeline-kit/core` deps

| Dep | Version | Anchor | Type |
|---|---|---|---|
| zod | ^4.4.3 | ADR6 | dep |
| ulid | ^3.0.2 | ADR16 | dep |
| p-retry | ^8.0.0 | ADR13 | dep |
| @opentelemetry/api | ^1.9.1 | ADR8 | peerDep |
| @opentelemetry/sdk-node | ^0.217.0 | ADR8 | peerDep (optional) |
| @opentelemetry/exporter-trace-otlp-http | ^0.217.0 | ADR8 | peerDep (optional) |

### `@pipeline-kit/process-reviewable` deps

| Dep | Version | Anchor | Type |
|---|---|---|---|
| @pipeline-kit/core | workspace:* | — | dep |
| zod | ^4.4.3 | ADR6 | dep |
| gatewerk | >=0.1.0 | ADR14 | peerDep (optional via `peerDependenciesMeta`) |

### Dev deps (root)

| Dep | Version |
|---|---|
| @changesets/cli | ^2.31.0 |
| typescript / @biomejs/biome / vitest / fast-check / tstyche / @vitest/coverage-v8 | (already locked above) |

### Critical clarification — `gatewerk` peerDep

`gatewerk@0.1.0` is **local-only** (lives at
`~/Claude-Workspace/gatewerk/packages/sdk-ts/`), NOT yet on npm. M0 default
approach:

1. peerDep `"gatewerk": ">=0.1.0"` with `peerDependenciesMeta: { gatewerk:
   { optional: true } }` in `process-reviewable/package.json`.
2. For type-checking + tests in pipeline-kit's own dev environment, use
   `file:../../../gatewerk/packages/sdk-ts` link in `devDependencies`.
   Replaced by `^0.x` when gatewerk publishes.
3. Tests mock the Gatewerk transport (no real HTTP) — see Task 12.

If executor finds the file: link approach problematic for pnpm or tstyche
resolution, surface in OPEN QUESTIONS. Default to (A) until brain says
otherwise.

---

## 5. Tasks (dependency-ordered)

### Task 0 — Verify state + branch off

```bash
cd ~/Claude-Workspace/pipeline-kit
git log --oneline -5                    # confirm tip is 44b5758
git status --short                      # working tree clean
git checkout -b m0-composer-reviewable
ls docs/spec*.md                        # spec.md + 3 drilldowns present
```

### Task 1 — Bootstrap monorepo

Create root config:

- `package.json` — root manifest with `"packageManager": "pnpm@10.33.4"`,
  scripts: `typecheck` (`pnpm -r typecheck`), `lint` (`biome check .`),
  `format` (`biome format --write .`), `test` (`vitest run --coverage`),
  `test:types` (`tstyche`), `build` (`pnpm -r build`).
- `pnpm-workspace.yaml` — declares `packages/*`.
- `tsconfig.base.json` — strict + noUncheckedIndexedAccess +
  noImplicitOverride; ESNext target; module resolution `bundler`.
- `biome.json` — Biome 2 config; semis-on, single-quotes, 2-space indent
  (match Gatewerk-sdk-ts style).
- `vitest.config.ts` — coverage thresholds 80/80/75/80; environment `node`;
  pool `threads`; testTimeout `10_000`.
- `tstyche.config.json` — points at `**/*.test-d.ts`.
- `.changeset/config.json` — commit `false`, access `public`, baseBranch `main`.
- `.github/workflows/ci.yml` — matrix Node 20 + 22 + Bun latest; runs
  `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm
  test`, `pnpm test:types`. Coverage upload deferred to M0.5.

Create both package skeletons (`packages/core`, `packages/process-reviewable`)
with `package.json` (ESM-only, `"type": "module"`, exports map),
`tsconfig.json` extending base, empty `src/index.ts`.

Verify: `pnpm install` succeeds; `pnpm typecheck` + `pnpm test` pass with
zero source files.

**Commit:** `bootstrap: pnpm workspaces + biome + vitest + ci matrix`

### Task 2 — `core`: Result + envelopes + ID helpers

- `src/result.ts` — `Result<T, E>` + `ok()` / `err()` constructors per
  spec-api-surface.
- `src/envelope.ts` — `ResourceEnvelope` + `ErrorEnvelope` per ADR16. Error
  shape: `type`, `code`, `message`, `param?`, `doc_url?`, `request_id?`.
- `src/ids.ts` — `pk.ids.{run,atom,evt}` use `ulid` (time-ordered);
  `pk.ids.{pipe,src,proc,serve,review}` use `crypto.randomUUID()` truncated +
  prefix. Each returns `pk_<prefix>_<id>`. Export individual functions and
  `ids` namespace object.

Tests: format match + uniqueness (1000 generations) per ID helper.

**Commit:** `core: Result<T,E> + envelopes + ID helpers`

### Task 3 — `core`: PipelineContext

- `src/context.ts` — `PipelineContext` interface verbatim from
  `spec-api-surface.md` §"PipelineContext (ADR5)". Internal
  `createContext(opts)` Composer-side constructor (NOT exposed to userland).
  `attachMetadata()` mutates an internal map; `metadata` exposed as
  `Readonly<Record<string, unknown>>`.
- `TraceContext` re-exports OTel `Context`. `MemoryAdapter` interface stub
  (impl ships M0.5+).

**No `child(overrides)`** per ADR5 redline.

Tests: shape, defaults, AbortSignal pass-through, metadata mutation.

**Commit:** `core: PipelineContext + Composer constructor`

### Task 4 — `core`: stage interfaces + typed errors

`src/stages/`:
- `source.ts` — `Source<O>` (`iter` AsyncIterable + `fetch` Result).
- `store.ts` — `Store<T>` (`put` / `get` / `list` returning Result).
- `process.ts` — `Process<I, O>` (`run`).
- `serve.ts` — `Serve<I>` with **required** `idempotencySupport: 'required'
  | 'optional' | 'unsupported'` field (ADR9).
- `atom.ts` — `Atom<T>` extends `ResourceEnvelope`.
- `index.ts` — barrel.

`src/errors/` — typed unions: `SourceError`, `StoreError`, `ProcessError`,
`ServeError`, `RunError`, `ReviewError`, `WebhookError`. Each is
discriminated on `type` + carries Sentry-shape envelope fields per ADR4 + ADR16.

M0 ships **no impls** in core; impls land M0.5.

**Commit:** `core: stage interfaces (Source/Store/Process/Serve) + typed errors`

### Task 5 — `core`: Composer

Plan splits before writing (each file <300 lines):

- `src/composer/composer.ts` — top-level orchestrator (~150 lines target).
- `src/composer/retry.ts` — `p-retry` wrapper applying `RetryPolicy` per
  ADR13. Defaults: maxAttempts 3, baseDelayMs 100, maxDelayMs 30000, jitter
  'full', respectRetryAfter true. Retryable: `['rate_limited', 'transient',
  'network', 'timeout', 'unavailable']`. Non-retryable short-circuits:
  `['auth', 'permanent', 'validation', 'idempotency_conflict']`. Both
  layers: global per-Pipeline budget + per-Stage policy.
- `src/composer/rate-limit.ts` — token-bucket per ADR10. Default
  10/10/1000 (10 req/sec). Same primitive serves rate-limit AND retry budget.
- `src/composer/otel.ts` — span hooks per ADR8. Span name `pipeline.<stage>`
  with `runId`/`pipelineId`/`attempt` attributes; OK/ERROR mapping from
  Result<T, E>; `recordException(err)` for stack traces.
- `src/composer/idempotency.ts` — auto-generates `pk_evt_<ulid>` per
  `Composer.run()` invocation; per-Serve scope `<runId>:<serveAdapterId>:<atomId>`;
  **no cache** per spec redline.
- `src/composer/cancellation.ts` — `AbortSignal` propagation; abort →
  `Result<null, RunError>` with `error.type === 'cancelled'`.
- `src/composer/index.ts` — barrel.

Tests: `tests/composer/` — one spec per file: lifecycle, retry classification,
rate-limit exhaustion, OTel spans, idempotency propagation, cancellation.

**Commit:** `core: Composer + retry + rate-limit + OTel + idempotency + cancellation`

### Task 6 — `core`: Pipeline chainable factory

- `src/pipeline.ts` — `Pipeline.from(s)` returning `SourcePipeline<O>` with
  `.through()`, `.store()`, `.review()`, `.to()`, `.describe()`. Exact
  signatures from `spec-api-surface.md` §"Pipeline composition (ADR12)".
- `src/pipeline-types.ts` — `SourcePipeline<O>`, `TerminalPipeline<O>`,
  `RunOptions`, `RunResult<O>`, `PipelineDefinition`.
- `.review(rev)` = `.through(reviewableWrapper(rev))` (sugar over the
  primitive). Per ADR12 redline.
- `Pipeline<Input, Output>` generic over both per ADR12 redline. No-input
  Source → `Input = void`, `pipeline.run()`. Source taking external query →
  `Input = SourceQuery`, `pipeline.run(query)`.

Tests: `tests/pipeline.spec.ts` (runtime) + `tests/pipeline.test-d.ts`
(tstyche type-narrowing; mismatched generics fail compile).

**Commit:** `core: Pipeline chainable factory + type-narrowing tests`

### Task 7 — `core`: webhook helpers

- `src/webhooks/sign.ts` — `pk.webhooks.sign(payload, secret, options?)`
  returns formatted single-header value `t=<unix>,v1=<hex>` (header NAME is
  set by userland). Use `crypto.createHmac('sha256', secret)`.
- `src/webhooks/verify.ts` — `pk.webhooks.verify(rawBody, sigHeader, secret,
  options?) → Result<PipelineKitEvent, WebhookError>`. Parse
  `t=...,v1=...`-shaped header; default tolerance 300_000ms; constant-time
  compare via `crypto.timingSafeEqual`.
- `src/webhooks/types.ts` — `PipelineKitEvent` discriminated union over
  `pipeline.run.{created,completed,failed}` and `review.{created,decided}`.
  Payload bodies stub-typed in M0; real flows wire M0.5+.
- `src/webhooks/index.ts` — `webhooks` namespace barrel.

Tests: roundtrip; replay rejection; multi-version header parsing
(`t=...,v1=...,v2=...`); timing-safe assertion.

**Commit:** `core: webhook sign/verify with Stripe-canon header`

### Task 8 — `core`: SDK factory + 4 resources

- `src/client.ts` — `createPipelineKit(config?)` per ADR23. Config: `apiKey`,
  `url`, `memory`, `timeout`, `retryPolicy`. Env-var fallback:
  `PIPELINE_KIT_API_KEY`, `PIPELINE_KIT_URL`.
- `src/resources/pipelines.ts`, `runs.ts`, `atoms.ts` — **stubbed** methods
  returning `Result<null, ErrorEnvelope>` with `error: { type:
  'not_implemented', code: 'pk_resources_v0', message: 'pk.<resource>.* require
  a pipeline-kit-cloud backend (v2). For v0, use Pipeline factory directly.',
  doc_url: '...' }`. Methods are typed correctly — SDK shape stable across
  v0→v1→v2.
- `src/resources/webhooks.ts` — **NOT stubbed**: re-exports `sign` + `verify`
  from `webhooks/`.
- `src/index.ts` — public barrel.

> **Why stubbed?** ADR22: kit is library-not-runtime; `pk.pipelines.*` etc.
> become real when `pipeline-kit-cloud` (v2) ships. Mounting the shape now
> avoids breaking changes later.

Tests: factory env-var resolution; stubs return correct error shape; tstyche
on 4-resource shape.

**Commit:** `core: createPipelineKit factory + 4-resource SDK shape`

### Task 9 — `process-reviewable`: Reviewable<I> interface

- `src/reviewable.ts` — `ReviewableConfig`, `ReviewResponse<I>` discriminated
  union, `Reviewable<I>` per ADR14 + spec-api-surface. Return shape is
  `Result<ReviewResponse<I>[], ReviewError>` (list-of-responses) from day one.
- `src/errors.ts` — `ReviewError` typed union: `transport`, `auth`,
  `timeout`, `cancelled`, `unsupported`, `unknown`.

Tests: trivial in-memory reviewable returning single-response list conforms.

**Commit:** `process-reviewable: Reviewable<I> interface + ReviewResponse<I>`

### Task 10 — `process-reviewable`: EditableField<T>

- `src/editable-field.ts` — `EditableField<T>` interface + `Field` namespace
  per ADR19. Concrete invariants:
  - `Field.unedited(x)` → `{ suggested: x, approved: x, wasEdited: false }`.
  - `Field.edited(s, a)` → `{ suggested: s, approved: a, wasEdited: !deepEqual(s, a) }`.
  - `Field.rejected(x)` → `{ suggested: x, approved: null, wasEdited: false }`.

Use `node:util.isDeepStrictEqual` for `wasEdited` determination (Node
native, works in Bun; zero new deps). If Bun CI fails, surface in OPEN
QUESTIONS.

Tests: three constructor invariants + property test (one of the 5 M0).

**Commit:** `process-reviewable: EditableField<T> + Field namespace`

### Task 11 — `process-reviewable`: reviewable-wrapper

- `src/reviewable-wrapper.ts` — `reviewableWrapper(reviewable)` factory
  returning `Process<I, I>`. Decision mapping:
  1. `reviewable.review(input, ctx) → Result<ReviewResponse<I>[], ReviewError>`.
  2. ReviewError → `error: { type: 'process', code: 'review_failed', ... }`.
  3. Empty list → `error: { type: 'process', code: 'review_no_response', ... }`.
  4. Pick first non-`ignored` response; if all `ignored`, fall through to last.
  5. `'approved'` → `data: response.value` (preserves I shape).
  6. `'rejected'` → `error: { type: 'process', code: 'review_rejected', message: response.reason ?? '...', ... }`.
  7. `'retry'` → `error: { type: 'transient', code: 'review_retry_requested', ... }` (Composer retry policy re-attempts per ADR13).
  8. `'ignored'` (sole) → `error: { type: 'process', code: 'review_ignored', ... }`.

`Pipeline.review(rev)` in core wires through this — same execution path.

Tests: one per decision type (5 tests).

**Commit:** `process-reviewable: reviewable-wrapper Process<I,I>`

### Task 12 — `process-reviewable`: GatewerkReviewable + ConsoleReviewable

- `src/gatewerk-reviewable.ts` — `GatewerkReviewable<I>` class implementing
  `Reviewable<I>`. Construction: `new GatewerkReviewable({ client,
  templateId, config })` where `client` is a `gatewerk` SDK client (peerDep,
  type-only import: `import type { GatewerkClient } from 'gatewerk'`).
  `review()` calls `client.reviews.create(...)`, awaits
  `client.reviews.get(reviewId)` until decision lands or `ctx.signal` aborts.
- `src/console-reviewable.ts` — `ConsoleReviewable<I>` for dev. Prints
  `describe(input)`, prompts `[a]pprove [r]eject [e]dit [q]retry [i]gnore`,
  returns `ReviewResponse<I>[]` of length 1. Gated behind `process.stdin.isTTY`
  — non-TTY returns `error: { type: 'unsupported', ... }` (CI doesn't hang).

> **Mocking gatewerk:** Define `GatewerkClientLike` structural type local to
> test fixtures matching the methods GatewerkReviewable calls
> (`reviews.create`, `reviews.get`). Production code uses type-only imports
> from `gatewerk` (no runtime dep when peerDep absent).

Tests: 5 GatewerkReviewable tests with mocked transport (approve / approve-
with-edit / reject / retry / timeout); 2 ConsoleReviewable (TTY false →
unsupported; TTY true with mocked stdin → approve).

**Commit:** `process-reviewable: GatewerkReviewable + ConsoleReviewable`

### Task 13 — Property tests + tstyche

By Task 12, ~40-45 unit/integration tests committed. Add remaining property
+ type-level to hit targets.

Property tests (5 total, one already in Task 10):
- `core/tests/composer/idempotency.property.ts` — same idempotencyKey across
  N runs produces identical `Context.idempotencyKey` observed by stages.
- `core/tests/composer/cancellation.property.ts` — abort during arbitrary
  stage → `error.type === 'cancelled'` (never unhandled rejection).
- `core/tests/composer/otel.property.ts` — every stage produces a span;
  root `pipeline.run` has at least one child per stage.
- `process-reviewable/tests/reviewable.property.ts` — `'approved'`
  preserves `typeof input === typeof value` (primitives) / shape (objects).
- `process-reviewable/tests/editable-field.property.ts` — already in Task 10.

tstyche files (`*.test-d.ts`):
- `core/tests/pipeline.test-d.ts` — chainable type-narrowing.
- `core/tests/resources.test-d.ts` — 4-resource SDK shape.
- `core/tests/result.test-d.ts` — Result<T, E> narrowing on `if (r.error)`.

**Commit:** `tests: 5 property tests + tstyche type-narrowing`

### Task 14 — Coverage gate + README + final pass

`pnpm test:coverage` — verify thresholds 80/80/75/80. If any falls below,
add tests rather than weaken thresholds.

`pnpm lint --apply` + `pnpm format`. Final all-gates run.

Add root `README.md` (50-80 lines):
- One-paragraph what-it-is.
- Quickstart code block: `Pipeline.from(s).through(p).review(rev).to(srv).run()`.
- Link to `docs/spec.md`.
- "v0 status: M0 shipped — kernel + Reviewable<I>; M0.5 ships 15 reference
  adapters."
- License: MIT (Q6 brain-locked 2026-05-06; LICENSE file at repo root).

**Commit:** `m0: coverage gate green + README + final lint/format pass`

### Task 15 — Smoke

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm test:types

bun install --frozen-lockfile
bun test packages/core/tests/
bun test packages/process-reviewable/tests/

# Counts:
pnpm vitest run --reporter=json | jq '.numTotalTests'   # >= 50

# Coverage:
pnpm test:coverage --reporter=text-summary | tail -20
# Expected: lines >= 80%, functions >= 80%, branches >= 75%, statements >= 80%
```

No commit (verification only).

---

## 6. Verification gates

All five green = code-level done:

```
pnpm typecheck            # zero errors
pnpm lint                 # zero violations
pnpm test                 # all green; thresholds met
pnpm test:types           # all green
bun test                  # runtime-compat smoke
```

Coverage thresholds (per ADR15 + spec §3): lines >=80%, functions >=80%,
branches >=75%, statements >=80%. **Add tests** to close gaps; never
weaken thresholds.

Test count target: **50+ unit/integration + 5 property + 3+ tstyche** =
58+ total. If executor finishes <50 unit with all gates green, surface in
OPEN QUESTIONS — do NOT pad with make-work tests.

**Push policy:** do NOT push. Brain authorises after report-back review.

---

## 7. Report-back format

```markdown
## Summary
<1 paragraph: what M0 shipped, branch + tip, two packages bootstrapped,
total test count, coverage stats, gates green/red>

## Tasks completed
- [x] Task 0  — State verified, branch off <hash>
- [x] Task 1  — Bootstrap monorepo (pnpm + biome + vitest + CI)
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
- [x] Task 15 — Smoke

## Verification (5 gates)
- pnpm typecheck:    <pass>
- pnpm lint:         <pass>
- pnpm test:         <N tests; lines/func/branch/stmt %>
- pnpm test:types:   <pass / N tstyche assertions>
- bun test:          <pass>

## Test counts
- Unit/integration:  <N> (target: 50+)
- Property:          <N> (target: 5)
- tstyche:           <N> (target: 3+)
- TOTAL:             <N>

## Files added
- packages/core/src/                     <N> files / <N> lines
- packages/core/tests/                   <N> files / <N> lines
- packages/process-reviewable/src/       <N> files / <N> lines
- packages/process-reviewable/tests/     <N> files / <N> lines
- root config files: <list>

## Branch state
- Branch: m0-composer-reviewable
- Tip: <short hash>
- Commits: <count> (one per Task checkpoint)
- Pushed: no (brain authorises)

## OPEN QUESTIONS
<bullet list — paste any items from Section 9 hit during implementation,
plus anything unexpected that surfaced>

## Loop α validation status
<one paragraph: did GatewerkReviewable wire end-to-end in mocked-transport
tests? are 5 ReviewResponse decision types covered? does Pipeline.review()
sugar verifiably equal Pipeline.through(reviewableWrapper(rev))?>
```

---

## 8. Non-goals (explicit — do NOT do these)

- Do NOT ship the 15 other reference adapters (api/webhook/apify/mcp-tool
  Source; postgres/sqlite/pgvector Store; extract/classify/validate/route
  Process; email/slack/webhook/mcp-tool Serve). **M0.5**.
- Do NOT build Trades Outbound. **M1**.
- Do NOT ship `Audited<I,O>` / `AuditAdapter` / `AuditEntry`. **M2**.
  *Author note (Q5 override 2026-05-06):* M0 exports NO Audited symbol —
  neither real impl nor `not_implemented` stub. M2 adds full impl as
  non-breaking additive; Audited is a free function, not an SDK resource.
- Do NOT ship `SlackEmojiReviewable` / `EmailLinkReviewable`. **M0.5**.
- Do NOT build durable-runtime infra (event queue, checkpointer, scheduler,
  dead-letter). Per ADR22, kit is library-not-runtime.
- Do NOT ship `@pipeline-kit/composer-{inngest,trigger}` thin wrappers. **v1**.
- Do NOT add Effect.ts. ADR1 declines for v0.
- Do NOT add ArkType. **v1** profile-driven re-evaluation.
- Do NOT add Saga / Outbox patterns. **v2**.
- Do NOT add marketplace surface or `pk.adapters` resource. **v1+**.
- Do NOT add `child(overrides)` to `PipelineContext`. **v1+**.
- Do NOT add CloudEvents emission mode. **v1** (ADR-D).
- Do NOT unify route-policy. **v1** (ADR-C).
- Do NOT add `feedback-aware-process`. **v1**.
- Do NOT auto-publish to npm in CI. Changesets is wired but publishing
  stays gated until M0.5 / M1.
- Do NOT rename `pk_atom_` / `Atom<T>`. Family-of-products renaming question
  (spec §5 #18) is separate — not bundled into M0.
- Do NOT push the branch. Brain authorises.
- Do NOT add agent-forge, pursuit, gatewerk, mediaflow paths beyond
  Section 4's `gatewerk` peerDep.
- Do NOT split M0 across multiple branches. One branch, multiple commits
  per Task.

---

## 9. OPEN QUESTIONS FOR BRAIN

> **Brain reviewed 2026-05-06.** 8 questions locked-default + 1 override (Q5)
> + 1 defer-to-executor (Q10). Question text retained for future-brain
> context. Decision lines codify resolutions; surface in report-back only
> if executor hits an unresolvable edge case despite locked defaults.

1. **`gatewerk` SDK availability strategy.** Local-only at
   `~/Claude-Workspace/gatewerk/packages/sdk-ts/`; not on npm. Default
   approach (Section 4): peerDep + `peerDependenciesMeta optional` + `file:`
   link in dev. If file: link breaks pnpm/tstyche resolution, alternatives:
   (B) publish gatewerk first, (C) include pipeline-kit in gatewerk's pnpm
   workspace.
   **`Decision: locked-default`** — (A). Industry-standard for unpublished
   family deps. Executor surfaces only if file: link fails pnpm/tstyche.

2. **Vitest 4 / fast-check 4 vs spec-mentioned 2.x / 3.x.** Latest stable on
   2026-05-06 is Vitest 4.1.5 / fast-check 4.7.0. Spec-build-plan.md §3
   says "Vitest 2.x" / "fast-check 3.x". M0 brief locks latest stable per
   "resolve concrete latest-stable versions" instruction.
   **`Decision: locked-default`** — Vitest 4 / fast-check 4. Version-pin
   update, NOT ADR15 re-deliberation. Spec-build-plan.md §3 text drift
   queued for M0.5 / M1 cycle (separate brain task).

3. **`ConsoleReviewable` non-TTY semantics.** Default returns `unsupported`
   error in non-TTY (CI doesn't hang). Alternative: auto-approve for CI
   smoke tests.
   **`Decision: locked-default`** — `unsupported`. Auto-approve in CI is a
   security smell; could mask reviewer-bypass bugs in downstream Reviewable
   adapters. Safe-default discipline.

4. **`pk.{pipelines,runs,atoms}` stub vs no-mount.** ADR22: kit is
   library-not-runtime; these resources only have real backends in v2 cloud.
   Default: stub-with-`not_implemented`-error to keep SDK shape stable
   v0→v1→v2. Alternative: don't mount until v2 (breaking change at v2).
   **`Decision: locked-default`** — stub. ADR23 explicitly mounts the 4
   resources; SDK shape stability is load-bearing for v0→v1→v2 evolution.
   Stub error is clear ("requires pipeline-kit-cloud backend (v2); for v0
   use Pipeline factory directly").

5. **`Audited` export reservation.** ADR18 ships `Audited<I,O>` in v0 but
   M0/M2 split puts impl in M2. Brief's pre-review default: export `Audited`
   symbol that returns Process<I,O> with `not_implemented` error.
   Alternative: don't export until M2 (non-breaking add later).
   **`Decision: override`** — do **NOT** export `Audited` (any form) in M0.
   M2 ships real impl + `AuditAdapter` + `AuditEntry`. Free-function
   additive add at M2 is non-breaking; symmetry with Q4 stubs is weak
   because those are SDK resources where shape stability is load-bearing,
   whereas `Audited` is a free function. Section 8 non-goals already
   aligned ("Do NOT ship Audited / AuditAdapter. M2."); Author note added
   in Section 8 to clarify the override extends to the symbol export.

6. **README license.** Gatewerk uses ELv2 + cloud-only. pipeline-kit is a
   kit — broader adoption wants permissive.
   **`Decision: locked-default`** — MIT. Library wants broad adoption with
   no commercial-use restrictions; ELv2 is the cloud-product positioning,
   not the library. Task 14 README updated to drop "TBD" wording.

7. **CI matrix Bun version.** Pin `^1.3` or float "latest"?
   **`Decision: locked-default`** — pin `^1.3` for M0; re-evaluate at M0.5.
   Reproducibility > drift convenience for early-stage CI.

8. **Test count fluidity.** If naturally <50 unit tests with all gates
   green, surface rather than pad.
   **`Decision: locked-default`** — no make-work tests. Quality > quantity.
   Section 6 already encodes the surface-don't-pad policy; report-back
   carries any deviation.

9. **`MemoryAdapter` interface stub vs no-export.** PipelineContext has
   `memory?: MemoryAdapter`; impl ships M0.5+.
   **`Decision: locked-default`** — ship interface. PipelineContext.memory?
   field requires the type for coherent strict-mode TypeScript; hiding the
   interface but exposing the optional field is incoherent.

10. **`isDeepStrictEqual` Bun compat.** Used in EditableField for
    `wasEdited`. If Bun CI fails on `node:util`, surface — default works
    Node 20 + 22 LTS.
    **`Status: defer-to-executor`** — runtime-compat unknown answerable
    only at test time. Brief contingency (surface-in-OPEN-QUESTIONS if Bun
    fails) already documents the path; no brain pre-decision needed. If
    Bun fails, executor surfaces; brain picks fallback (e.g., write
    structural deep-eq helper, or scope dep `fast-equals`).

---

## 10. Coordination with future briefs

After M0 ships:

- **M0.5 brief** picks up the 15 deferred reference adapters per
  `spec-adapters.md` §2. Adapter packages live as
  `packages/{source,store,process,serve}-*`; same pnpm workspace + same
  Biome / Vitest / TypeScript config inherited from `tsconfig.base.json`.
  Each adapter ships independently per Changesets.
- **M1 brief** picks up Trades Outbound — first concrete pipeline-kit
  consumer; validates Loop γ. Lives in `~/Claude-Workspace/trades-outbound/`
  consuming `@pipeline-kit/*` from local file: links pre-publish or npm
  post-publish (brain decides).
- **M2 brief** picks up `Audited<I,O>` + Gatewerk audit log integration;
  validates Loop β by refactoring Gatewerk's review-routing /
  notification-fanout / audit-aggregation pipelines onto pipeline-kit.
- **HANDOFF.md update** on M0 completion: pipeline-kit's HANDOFF (or
  pursuit's, if shared) flips Track A from "M0 executor session ready" to
  "M0 shipped, M0.5 brief drafting queued".

---

*End of M0 brief. Estimated 8-12 executor hours. Branch off `master` tip
`44b5758`. All gates green = code-level done; brain authorises push after
report-back review.*

*Author: Brain — 2026-05-06.*
*Phase 2 inputs: spec.md (1510 lines) + spec-api-surface.md (225) +
spec-adapters.md (210) + spec-build-plan.md (290).*
*Phase 3 v0 build queues from this brief.*

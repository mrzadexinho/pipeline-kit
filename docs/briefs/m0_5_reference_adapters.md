# Brief — M0.5 Reference Adapters (15 packages) + Composer fan-out

> **Branch:** `m0-5-reference-adapters`
> **Author (brain):** Idris's brain session, 2026-05-07
> **Estimated executor effort:** 35-50 hours (3-5 sessions; brain check-ins
> after Task 1 (Composer fan-out), after Task 7 (Source adapter cluster
> done), and after Task 13 (Process adapter cluster done))
> **Status:** Ready for executor pickup. Branches off `master` (tip
> `7d8fd44` — M0 shipped + report-back landed).
> **Predecessor:** M0 (commit `7d8fd44`; 231 tests; gates green; Loop α
> validated).

**Strategic context:** M0.5 closes the v0 reference-adapter contract per
`spec-adapters.md` §2 — 15 packages spanning Source / Store / Process /
Serve. M0 shipped #12 (`reviewable-wrapper`) inside `process-reviewable`;
the remaining 15 ship here. M0.5 also upgrades Composer's run-loop from
M0's first-atom shortcut to true Source fan-out per ADR7 + ADR9, since
4 of the 15 new Source adapters emit multi-atom natively (Apify dataset,
paginated REST, batched webhooks, MCP-tool array results).

**What's locked:** all 23 v0 ADRs + the API surface in
`spec-api-surface.md` + the adapter contract in `spec-adapters.md` §2.
**Do NOT re-deliberate.** Two architectural carry-forwards from M0 are
resolved in Section 0 below; per-adapter design hinges on both.

---

## Section 0 — Architectural locks inherited from M0

These two locks resolve M0 OPEN QUESTIONS that are load-bearing for the
adapter signatures below. **No adapter design is writeable until these
are locked.** Both are locked here; do not re-deliberate.

### Lock 1 — Reviewable canonical location (resolves M0 OQ-1)

**Decision: `Reviewable<I>` + `ReviewableConfig` + `ReviewResponse<I>` +
`ReviewError` live in `@pipeline-kit/core`. `process-reviewable` owns
impls and re-exports.**

This was M0's de-facto outcome. `core/src/reviewable.ts` defines the
type contracts; `core/src/reviewable-to-process.ts` defines the conversion
engine (`reviewableToProcess`). `process-reviewable` re-exports those
types under their canonical names plus exposes `reviewableWrapper` (alias
of `reviewableToProcess`) and ships impls — `EditableField<T>` + `Field`
namespace, `GatewerkReviewable`, `ConsoleReviewable`. Future Reviewable
impls in M0.5+ (Slack-emoji, email-link — both deferred to v1) extend
the same package.

**Rationale:** `core` cannot import from `process-reviewable`
(process-reviewable depends on core). `Pipeline.review(rev)` in core
needs to wire through `reviewableToProcess`, so the type contracts and
conversion logic must live in core. The public-name ergonomics
(`reviewableWrapper` = the conventional adapter name in user code) live
in `process-reviewable` to keep the adapter package the public-facing
home for HRP composition.

**Spec-text touch-up (Task 18 of this brief):** `spec-api-surface.md`
§"Reviewable<I> (ADR14)" gets a clarifying line — "Exported from
`@pipeline-kit/core`; re-exported (alongside `EditableField<T>` + impls)
from `@pipeline-kit/process-reviewable` for ergonomic access in adapter-
land." No ADR change.

### Lock 2 — Source fan-out semantics (resolves M0 OQ-3)

**Decision: option (B) — Composer iterates atoms emitted by Source;
each downstream stage is invoked once per atom. `Process<I, O>` signature
unchanged. `RunResult.atomCount` = source emit count. `RunResult.output`
= last successfully processed atom's output.**

#### Why (B) over (A) and (C)

ADR7 ("Both streaming `iter` and batch `fetch` primary on Source") and
ADR9 (per-Serve idempotency scope `<runId>:<serveAdapterId>:<atomId>`)
both anticipate fan-out at the orchestration layer:

- **(A) First-atom only** is M0's stopgap. It directly contradicts
  ADR7 — if only one atom is consumed, why does `Source<O>.fetch` return
  `Atom<O>[]` and `iter` return `AsyncIterable<Atom<O>>`? The plural
  shape is load-bearing for fan-out. (A) would also break Apify-source
  (datasets routinely emit 50K+ records), api-source paginated grabs
  (cursor pagination loses post-page-1 atoms), webhook-source batched
  payloads (Stripe/Slack/etc. pack N events per delivery), and
  mcp-tool-source array returns. M0's first-atom-only path is acceptable
  only because M0's single Reviewable wrapper sees one atom per run; v0
  reference adapters surface real fan-out.

- **(C) Atom-mapped Process<Atom<I>, Atom<O>>** changes `Process` from
  pure transformation to envelope-aware. This breaks the M0 stage
  interface, breaks "functional core, imperative shell" (Process becomes
  shell-aware), and forces every Process adapter to thread atom metadata
  through. Heavy retroactive change for marginal gain — Process is
  pure-transform; envelope plumbing is orchestrator concern.

- **(B) Iterate-and-dispatch** keeps `Process<I, O>` pure (Composer
  unwraps `atom.data` and passes `I`), keeps `Source<O>` shape exactly
  as ADR7 specs (both methods primary), satisfies ADR9's per-atom
  idempotency scope verbatim, and reads "M0's first-atom Composer was
  always provisional, lifted to per-atom in M0.5" — which it was.

#### Composer behavioral spec for Lock 2 (Task 1 of this brief)

1. **Run-loop primary path is `Source.iter()`.** Composer iterates the
   `AsyncIterable<Atom<O>>` lazily; back-pressure naturally gates atom
   throughput at downstream stage's processing rate. `Source.fetch()`
   is exposed for direct callers (test fixtures; user code wanting a
   batch grab) but is NOT the run-loop's primary path. Per ADR7
   "Composer's Pipeline runtime chooses streaming when downstream
   Process is back-pressure-aware; otherwise batch" — v0 simplification:
   always streaming via `iter`. Future v1 may add adaptive selection.

2. **Per-atom stage invocation.** For each atom yielded:
   - Process (if present): `process.run(atom.data, ctx)` — singular
     `I` in, singular `O` out. Composer wraps `O` back into a new atom
     (preserving lineage: `id` regenerated, `source_id` pointing at
     prior atom's `source_id`, `metadata` merged).
   - Store (if present): `store.put(atom, ctx)` — atom-shaped.
   - Reviewable (if present, via `reviewableWrapper`):
     `process.run(atom.data, ctx)` — same as Process, since wrapper
     surface is `Process<I, I>`.
   - Serve (if present): `serve.emit(atom.data, ctx)` — singular `I` in.

3. **Idempotency-key per atom.** `<runId>:<serveAdapterId>:<atomId>`
   per ADR9. Each atom gets a distinct Serve idempotency scope.

4. **OTel per atom.** Each stage span carries an `atom.id` attribute;
   spans nest under a per-atom child span of `pipeline.run`. Property
   test: every atom produces `stageCount` spans; root span has
   `atomCount` × `stageCount` descendants.

5. **Per-atom retry.** A failing atom triggers RetryPolicy at that
   atom's stage. Retry budget per ADR13 + ADR10's token-bucket. If
   exhausted, the run fails fast with that atom's error; subsequent
   atoms NOT processed. (v0 simplification — partial-success semantics
   defer to v1; matches Inngest fail-fast default.)

6. **Empty Source.** Zero atoms emitted → `Result<RunResult, RunError>`
   with `error: { type: 'unavailable', code: 'source_no_atoms', ... }`.
   Preserves M0 behavior; just now triggered by genuine empty iterable
   (M0's first-atom path triggered it on `atoms[0] === undefined` from
   `Atom[]`). Adapters can opt-into `allowEmpty: true` config to return
   a successful `RunResult` with `atomCount: 0` and `output: undefined`
   — useful for scheduled-source pipelines that legitimately no-op.
   v0 default: error on empty.

7. **Cancellation.** `ctx.signal.aborted` checked between atoms (loop
   header) and propagated to in-flight stage. Abort mid-iteration → next
   atom not started; in-flight stage's current attempt observes
   `ctx.signal.aborted`; result is `{ error: { type: 'cancelled', ... } }`.

8. **`RunResult` semantics.**
   - `output: O` = last successfully processed atom's output (M0
     behavior preserved for the single-atom case; extended for multi).
   - `atomCount: number` = count of atoms emitted by Source (NOT count
     of stage successes; if atom 5 of 10 fails, `atomCount` is still 10
     by ADR12 spec — but `output` reflects atom 4's output and
     `error.metadata.failed_at_atom` carries atom 5's id for triage).
   - `outputs?: ReadonlyArray<O>` is **NOT added** in M0.5 — keep
     `output` singular per spec; users who need per-atom outputs wire
     a Store adapter or read from OTel spans.

9. **`Source.fetch` direct-call semantics.** Unchanged from M0 contract.
   `fetch` is for batch grab; the property test "iter and fetch produce
   same data" (per spec §3) holds for every v0 Source adapter — adapters
   implement both, even if Composer's run-loop only uses iter.

#### Test additions for Lock 2 (Task 1)

Composer fan-out test suite (`packages/core/tests/composer/fan-out.test.ts`):

- Multi-atom Source (3 atoms) → Process invoked 3 times with each atom's
  `data` as `I`.
- Multi-atom Source (3 atoms) → Serve invoked 3 times with each atom's
  data; idempotency keys distinct across atoms.
- `RunResult.atomCount === 3` for 3-atom emit.
- `RunResult.output` === last atom's output.
- Per-atom failure: atom 2 of 3 errors after 1 retry → run errors with
  atom 2's error; atom 3 not processed; `atomCount === 3` (emit count
  preserved); `metadata.failed_at_atom` === atom 2's id.
- Cancellation mid-iteration: signal aborts during atom 2 of 3 → result
  is `cancelled`; atom 3 not processed.
- Empty Source (0 atoms) → `error.code === 'source_no_atoms'`.
- Per-atom OTel spans: 3 atoms × 3 stages = 9 span emissions plus root.

Property test addition (`composer/fan-out.property.test.ts`):

- For arbitrary Source emit count `n`, `Process.run` invocation count
  equals `n` (no double-dispatch, no skip).
- For arbitrary `n`, all `n` Serve idempotency keys are pairwise
  distinct (no collision across atoms).

---

## 1. Engineering philosophy

Inherited from M0; no changes. Read `CLAUDE.md` end-to-end before
writing code; pipeline-kit memory entries (referenced below) are
durable lessons.

Hard rules:
- **300 lines soft / 500 lines hard** per file. 15 adapters means many
  small files; resist the urge to fold related adapters into one file.
- **Strict TypeScript.** `strict: true`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`. Zero `any` in source. `unknown` at boundaries.
- **ESM only.** `"type": "module"`; imports use `.js` suffix.
- **Result<T, E> kit-wide** (per ADR4); no thrown errors crossing public
  stage boundary.
- **Zod 4 at every Source/Serve boundary** (per ADR6); use `safeParse`,
  never `parse`. Coerce-at-boundary mode (`.catch(default)`) per
  pursuit's `feedback_pydantic_boundary_coercion.md` lesson.
- **Functional core, imperative shell.** No `class` for behavior unless
  lifecycle (resource cleanup, long-lived connection) demands it.
- **Comments only when WHY is non-obvious.** No "what" comments.
- **No emojis** in code, output, or commit messages.
- **`pnpm` only** for deps. Tests in `<package>/tests/` mirroring `src/`.

Read durable lessons before starting:

- `~/.claude/projects/-Users-zadexinho-Claude-Workspace-pipeline-kit/memory/feedback_spec_doc_discipline.md`
  — split docs >1500 / sub-files >500 lines.
- `~/.claude/projects/-Users-zadexinho-Claude-Workspace-pipeline-kit/memory/project_pipeline_kit_m0_shipped.md`
  — M0 ship state + carry-forwards.
- `~/.claude/projects/-Users-zadexinho-Claude-Workspace-pursuit/memory/feedback_pydantic_boundary_coercion.md`
  — coerce/truncate/default at LLM boundary; never strict caps.
  Internalise philosophy now — `extract-process` and `validate-process`
  apply it.

Verification gates (all five green before reporting back):

```
pnpm typecheck            # tsc --noEmit across all packages
pnpm lint                 # biome check
pnpm test                 # vitest run --coverage; thresholds 80/80/75/80
pnpm test:types           # tstyche on Pipeline + adapter types
bun test                  # runtime-compat smoke on Bun 1.3+
```

---

## 2. References — pipeline-kit family mining rule

**Lift patterns, not code.** Do NOT add family repos to `tsconfig` paths
or copy source files.

### Lift from family

- **`~/Claude-Workspace/gatewerk/packages/sdk-ts/`** — `createClient`
  factory pattern; resource-based SDK shape; webhook signing.
- **`~/Claude-Workspace/gatewerk/docs/research/ideas-to-steal.md`** —
  cross-reference catalog (SSRF protection, error envelopes, etc.).
- **`~/Claude-Workspace/pursuit/agents/tools/`** — adapter-folder shape;
  each tool one file, clear boundary.

### Library reference docs (read on demand, don't pre-read)

For SDKs the executor will integrate (don't fetch ahead of time; fetch
when actually wiring the adapter):

- **Drizzle ORM** — `https://orm.drizzle.team/` — schema/migrations,
  zod codegen via `drizzle-zod`, custom-type pattern (pgvector).
- **OpenAI SDK** — `https://github.com/openai/openai-node` —
  structured-output with Zod schemas via `openai.responses.parse`
  (or equivalent in current major).
- **Anthropic SDK** — `https://github.com/anthropics/anthropic-sdk-typescript`
  — tool use for structured output; messages.create.
- **Google GenAI SDK** — `https://github.com/google/generative-ai-js`
  (or the `@google/genai` rebrand if applicable as of install date) —
  generateContent with response_schema.
- **Hono** — `https://hono.dev/` — Web Standards-compatible HTTP routes;
  `@hono/zod-validator` middleware.
- **Apify Client** — `https://docs.apify.com/sdk/js/` — `apify-client`
  package; actor.run + dataset access.
- **MCP SDK** — `https://github.com/modelcontextprotocol/typescript-sdk`
  — Server / Client; tool registration + invocation.
- **Slack Web API** — `https://github.com/slackapi/node-slack-sdk` —
  `@slack/web-api`; chat.postMessage; idempotency via client_msg_id.
- **Nodemailer / Resend** — provider SDKs for `serve-email`.

**On version drift:** all version pins below are best-known stable as
of brief authoring (2026-05-07). Executor verifies on `pnpm install` and
surfaces drift in OPEN QUESTIONS. Use latest stable on the major line
unless a specific minor is called out.

---

## 3. Context — what M0 shipped + what M0.5 closes

### M0 ship state (commit `7d8fd44`)

- Two packages: `@pipeline-kit/core` + `@pipeline-kit/process-reviewable`.
- Toolchain locked: pnpm 10.33.4, TypeScript 6.0.3, Biome 2.4.14,
  Vitest 4.1.5, fast-check 4.7.0, tstyche 7.1.0, ulid 3.0.2, p-retry 8.0.0.
- 231 tests (210 vitest + 21 tstyche); coverage 90/80/91/92.
- Five gates green; bun runtime-compat smoke green.
- Loop α validated: `Pipeline.from(s).review(GatewerkReviewable).to(srv)
  .run()` runs end-to-end with mocked Gatewerk transport across 5
  ReviewResponse decision types.
- Composer's run-loop is **first-atom-only** (M0 stopgap; Lock 2 above
  upgrades to per-atom fan-out in Task 1 of this brief).

### M0.5 ship state (target)

- 15 new packages bootstrapped under `packages/{source,store,process,
  serve}-*/`. All inherit base TS/Biome/Vitest config from M0's
  `tsconfig.base.json` and root `vitest.config.ts`. Each is
  individually publishable via Changesets but ships in the same
  monorepo for testing cohesion.
- Composer fan-out upgrade landed (Task 1) — all 15 adapters' tests
  rely on it.
- Per-adapter test count target: 5-10 unit + 1-2 integration + 1
  property where applicable. 15 adapters × ~10 tests avg = ~150 new
  tests. Plus Composer fan-out (~15 tests), property tests (~5 new),
  tstyche (~5 new). M0.5 total NEW tests: ~175. Combined with M0's
  231: ~400+ in M0.5.
- Coverage thresholds unchanged: 80/80/75/80; `pnpm test` runs all
  packages.

### Loop α status

Loop α stays green throughout M0.5; no regression expected. M0.5's
Composer fan-out upgrade adds atom-iteration test cases that
GatewerkReviewable's existing single-atom path is a subset of.

### Out of scope (deferred)

- M1 Trades Outbound (first reference project; validates Loop γ).
- M2 `Audited<I,O>` + `AuditAdapter` + `AuditEntry`.
- v1 `enrich-process`, `dedup-process`, `summarize-process`, CRM
  serves, Voice/SMS/PDF serves, `feedback-aware-process`,
  `pursuit-demand-source`.
- v1 thin wrappers `@pipeline-kit/composer-{inngest,trigger}`.
- Slack-emoji + email-link Reviewable impls (defer to v1).

---

## 4. Stack locked for M0.5 — additional deps per adapter

All version pins below are best-known stable as of 2026-05-07. Executor
verifies on `pnpm install` and surfaces any drift in OPEN QUESTIONS.

### Shared (added to root devDependencies as needed)

| Dep | Version | Notes |
|---|---|---|
| zod-to-json-schema | ^3.24.x | LLM tool-call schema gen (extract, mcp-tool-serve) |
| drizzle-kit | ^0.31.x | Migration tooling for store-postgres / store-pgvector / store-sqlite (devDep, not runtime) |

### `@pipeline-kit/source-api`

| Dep | Version | Type |
|---|---|---|
| zod | ^4.4.3 | dep (workspace-pinned) |
| @pipeline-kit/core | workspace:* | dep |

Native `fetch` (Node 20+); no third-party HTTP client needed.

### `@pipeline-kit/source-webhook`

| Dep | Version | Type |
|---|---|---|
| hono | ^4.9.x | dep (verify on install; if Hono 5 is current stable, use ^5.0.0 — surface in OPEN QUESTIONS) |
| @hono/zod-validator | ^0.4.x | dep |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/source-apify`

| Dep | Version | Type |
|---|---|---|
| apify-client | ^2.13.x | dep |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/source-mcp`

| Dep | Version | Type |
|---|---|---|
| @modelcontextprotocol/sdk | ^1.x | dep (current major as of authoring; verify) |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/store-postgres`

| Dep | Version | Type |
|---|---|---|
| drizzle-orm | ^0.4x.x | dep (current minor as of authoring; verify — drizzle moves fast) |
| postgres | ^3.4.x | dep |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/store-sqlite`

| Dep | Version | Type |
|---|---|---|
| drizzle-orm | ^0.4x.x | dep |
| better-sqlite3 | ^11.x | dep (Node) |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

`bun:sqlite` is Bun-native (no install needed); adapter exports a
factory `forBun()` that uses `drizzle-orm/bun-sqlite`.

### `@pipeline-kit/store-pgvector`

| Dep | Version | Type |
|---|---|---|
| drizzle-orm | ^0.4x.x | dep |
| postgres | ^3.4.x | dep |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

PG extension `pgvector` required server-side; documented in package
README; not a JS dep.

### `@pipeline-kit/process-extract`

| Dep | Version | Type |
|---|---|---|
| zod | ^4.4.3 | dep |
| zod-to-json-schema | ^3.24.x | dep |
| openai | ^5.x or ^6.x | peerDep (optional; verify current major — `peerDependenciesMeta.openai.optional = true`) |
| @anthropic-ai/sdk | ^0.3x.x or ^1.x | peerDep (optional; verify) |
| @google/generative-ai | ^0.2x.x | peerDep (optional; if `@google/genai` is the current package name post-rebrand, use that — surface in OPEN QUESTIONS) |
| @pipeline-kit/core | workspace:* | dep |

Provider SDKs are peerDeps so users only install the providers they
use. Adapter loads provider modules dynamically (`await import(...)`)
gated on config.provider.

### `@pipeline-kit/process-classify`

| Dep | Version | Type |
|---|---|---|
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |
| @pipeline-kit/process-extract | workspace:* | peerDep (optional; only needed if `mode: 'llm'`; `peerDependenciesMeta.@pipeline-kit/process-extract.optional = true`) |

### `@pipeline-kit/process-validate`

| Dep | Version | Type |
|---|---|---|
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/process-route`

| Dep | Version | Type |
|---|---|---|
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/serve-email`

| Dep | Version | Type |
|---|---|---|
| zod | ^4.4.3 | dep |
| nodemailer | ^6.10.x | peerDep (optional; SMTP mode) |
| resend | ^4.x or ^5.x | peerDep (optional; Resend mode) |
| @pipeline-kit/core | workspace:* | dep |

Postal mode uses native `fetch`; no extra dep. Mode-gated dynamic
import.

### `@pipeline-kit/serve-slack`

| Dep | Version | Type |
|---|---|---|
| @slack/web-api | ^7.x | dep |
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

### `@pipeline-kit/serve-webhook`

| Dep | Version | Type |
|---|---|---|
| zod | ^4.4.3 | dep |
| @pipeline-kit/core | workspace:* | dep |

Native `fetch` + `node:crypto` (already in core for `pk.webhooks.sign`).

### `@pipeline-kit/serve-mcp`

| Dep | Version | Type |
|---|---|---|
| @modelcontextprotocol/sdk | ^1.x | dep |
| zod | ^4.4.3 | dep |
| zod-to-json-schema | ^3.24.x | dep |
| @pipeline-kit/core | workspace:* | dep |

### Critical clarification — peerDeps + `optional` pattern

Where a package supports multiple modes (e.g., `serve-email` SMTP /
Postal / Resend; `process-extract` openai / anthropic / gemini), the
adapter:
1. Declares each provider SDK as a peerDep with
   `peerDependenciesMeta: { <sdk>: { optional: true } }`.
2. Imports provider SDK dynamically: `const { default: nodemailer } =
   await import('nodemailer').catch(() => { throw NoProviderError; })`.
3. Validates at construction-time that the configured provider's SDK
   resolves; emits a clear `error.code: 'provider_not_installed'` if
   not, with `doc_url` pointing at a `/docs/install-providers.md` page
   (Task 17).

This pattern is industry-standard (Drizzle dialects, LangChain
integrations) and avoids forcing users to install every provider's
~50MB SDK when they only use one.

---

## 5. Per-adapter signature spec — drilldown

The 15-adapter signature spec lives in
[m0_5_reference_adapters-spec.md](m0_5_reference_adapters-spec.md) —
~720 lines covering one subsection per adapter (Path, Public exports,
Config schema, Behavior, Tests, ADR anchors). Lifted into a drilldown
because the consolidated brief crossed 1500 lines (per
`feedback_spec_doc_discipline.md`). Conventions applying to all 15
adapters live at the head of the drilldown.

Per-adapter sections (drilldown anchors):

| # | Adapter | Path |
|---|---|---|
| 1 | source-api | `packages/source-api/` |
| 2 | source-webhook | `packages/source-webhook/` |
| 3 | source-apify | `packages/source-apify/` |
| 4 | source-mcp | `packages/source-mcp/` |
| 5 | store-postgres | `packages/store-postgres/` |
| 6 | store-sqlite | `packages/store-sqlite/` |
| 7 | store-pgvector | `packages/store-pgvector/` |
| 8 | process-extract | `packages/process-extract/` |
| 9 | process-classify | `packages/process-classify/` |
| 10 | process-validate | `packages/process-validate/` |
| 11 | process-route | `packages/process-route/` |
| 12 | serve-email | `packages/serve-email/` |
| 13 | serve-slack | `packages/serve-slack/` |
| 14 | serve-webhook | `packages/serve-webhook/` |
| 15 | serve-mcp | `packages/serve-mcp/` |

Section 6 below references these by adapter number (e.g., Task 3
implements adapter #1); the drilldown is the source of truth for each
adapter's contract.

---

## 6. Tasks (dependency-ordered)

21 tasks. Each ends with a single commit. Tests in same commit as the
code they cover. Adapter packages bootstrapped (Task 2) before any
single adapter starts (Task 3+); Composer fan-out upgrade (Task 1)
lands first since 4 of 15 adapters' multi-atom tests depend on it.

### Task 0 — Verify state + branch off

```bash
cd ~/Claude-Workspace/pipeline-kit
git log --oneline -5                    # tip is 7d8fd44
git status --short                      # clean
git checkout -b m0-5-reference-adapters
ls packages/                             # core/, process-reviewable/ present
pnpm install                             # baseline; no lockfile drift expected
pnpm typecheck && pnpm lint && pnpm test # M0's 5-gates baseline still green
```

No commit (verification only).

### Task 1 — Composer fan-out upgrade

Upgrade `packages/core/src/composer/composer.ts` from M0's first-atom
shortcut to per-atom iteration per Lock 2. Affected files:

- Modify: `packages/core/src/composer/composer.ts` — replace
  `atoms[0].data` extraction with `for await (const atom of source.iter(...))`
  loop per Lock 2 §"Composer behavioral spec".
- Modify: `packages/core/src/composer/idempotency.ts` — per-atom scope
  derivation (`<runId>:<serveAdapterId>:<atomId>`) — already in shape
  from M0; verify no change needed.
- Modify: `packages/core/src/composer/otel.ts` — add `atom.id` attribute
  to per-stage spans; per-atom span hierarchy under root.
- Modify: `packages/core/src/composer/cancellation.ts` — check
  `ctx.signal.aborted` between atoms (loop header) in addition to
  in-flight stage.
- Add tests: `packages/core/tests/composer/fan-out.test.ts` (8 cases per
  Lock 2 §"Test additions"), `packages/core/tests/composer/fan-out.property.test.ts`
  (2 properties).
- Modify tests: any M0 test that mocks Source with a 2+ atom array in
  `fetch` and assumed first-atom-only Composer behavior — update to
  assert atomCount and per-atom invocation. M0's existing single-atom
  tests should continue passing unchanged (single-atom is a special
  case of N-atom).

Commit: `core: composer fan-out — iterate atoms; per-atom stage dispatch`

### Task 2 — Bootstrap 15 adapter package skeletons

For each of the 15 adapter packages (path enumerated in Section 5),
create:

```
packages/<kind>-<name>/
  package.json          # ESM-only; "type": "module"; exports map; deps per Section 4
  tsconfig.json         # extends ../../tsconfig.base.json
  src/
    index.ts            # exports the factory + types (empty body)
  tests/
    .gitkeep            # placeholder
  README.md             # 10-15 line minimal (description + install + link to docs/spec.md)
```

`pnpm-workspace.yaml` already declares `packages/*` (M0 setup); new
packages auto-discovered.

Run `pnpm install` after package.json files are written; verify
lockfile updates cleanly. Run `pnpm typecheck` — should pass with
empty `index.ts` files.

Commit: `m0.5: bootstrap 15 adapter package skeletons`

### Task 3 — `source-api` impl + tests

Per drilldown #1. Files:
- Create: `packages/source-api/src/api-source.ts` (~150-200 lines).
- Create: `packages/source-api/src/pagination.ts` (~80 lines for
  cursor/offset/page logic).
- Create: `packages/source-api/src/errors.ts` (HTTP status → SourceError
  mapping).
- Update: `packages/source-api/src/index.ts` (exports).
- Create tests: `packages/source-api/tests/api-source.test.ts`,
  `pagination.test.ts`, `iter-vs-fetch.property.test.ts` per drilldown #1.

Commit: `source-api: REST/GraphQL adapter with cursor pagination`

### Task 4 — `source-webhook` impl + tests

Per drilldown #2. Files:
- Create: `packages/source-webhook/src/webhook-source.ts` (Hono route +
  buffer queue; ~180 lines).
- Create: `packages/source-webhook/src/handler.ts` (raw web-standards
  handler; ~60 lines).
- Update: `packages/source-webhook/src/index.ts`.
- Create tests: `webhook-source.test.ts`, `hono-integration.test.ts`,
  `iter-buffer.test.ts` per drilldown #2.

Commit: `source-webhook: Hono-backed HMAC intake + buffered iter`

### Task 5 — `source-apify` impl + tests

Per drilldown #3. Files:
- Create: `packages/source-apify/src/apify-source.ts` (~180 lines).
- Create: `packages/source-apify/src/dataset-paginate.ts` (~50 lines).
- Update: `packages/source-apify/src/index.ts`.
- Create tests: `apify-source.test.ts`, `pagination.test.ts` per drilldown #3.

Commit: `source-apify: Apify actor wrapper with dataset pagination`

### Task 6 — `source-mcp` impl + tests

Per drilldown #4. Files:
- Create: `packages/source-mcp/src/mcp-source.ts` (~200 lines).
- Create: `packages/source-mcp/src/schema-derive.ts` (~80 lines for JSON
  Schema → Zod fallback).
- Update: `packages/source-mcp/src/index.ts`.
- Create tests: `mcp-source.test.ts`, `schema-derive.test.ts` per
  drilldown #4.

Commit: `source-mcp: generic MCP tool wrapper with schema auto-derive`

### Task 7 — `store-postgres` impl + tests + migrations

Per drilldown #5. Files:
- Create: `packages/store-postgres/src/postgres-store.ts` (~200 lines).
- Create: `packages/store-postgres/src/atom-table.ts` (defineAtomTable
  helper; ~60 lines).
- Create: `packages/store-postgres/src/idempotency-cache.ts` (~80 lines).
- Create: `packages/store-postgres/migrations/0001_init.sql` (DDL for
  atom + idempotency tables).
- Update: `packages/store-postgres/src/index.ts`.
- Create tests: `postgres-store.test.ts`, `migrations.test.ts`,
  `round-trip.property.test.ts` per drilldown #5.

Commit: `store-postgres: Drizzle Postgres adapter + migrations`

### Task 8 — `store-sqlite` impl + tests

Per drilldown #6. Files:
- Create: `packages/store-sqlite/src/sqlite-store.ts` (~180 lines;
  shared logic with postgres-store, factored to drizzle-orm shape).
- Create: `packages/store-sqlite/src/atom-table.ts` (~60 lines).
- Update: `packages/store-sqlite/src/index.ts`.
- Create tests: `sqlite-store.test.ts`, `bun-mode.test.ts`,
  `round-trip.property.test.ts` per drilldown #6.

Commit: `store-sqlite: Drizzle SQLite adapter (Node + Bun runtimes)`

### Task 9 — `store-pgvector` impl + tests

Per drilldown #7. Files:
- Create: `packages/store-pgvector/src/pgvector-store.ts` (~220 lines —
  larger due to search method).
- Create: `packages/store-pgvector/src/custom-type.ts` (pgvectorColumn;
  ~50 lines).
- Create: `packages/store-pgvector/src/embedding-table.ts`
  (defineEmbeddingTable; ~60 lines).
- Create: `packages/store-pgvector/migrations/0001_init.sql`.
- Update: `packages/store-pgvector/src/index.ts`.
- Create tests: `pgvector-store.test.ts`, `custom-type.test.ts`.

Commit: `store-pgvector: pgvector adapter with HNSW + IVFFlat indexes`

### Task 10 — `process-extract` impl + tests

Per drilldown #8. Files:
- Create: `packages/process-extract/src/extract-process.ts` (~200 lines).
- Create: `packages/process-extract/src/providers/openai.ts` (~80 lines;
  dynamic-import gated).
- Create: `packages/process-extract/src/providers/anthropic.ts` (~80 lines).
- Create: `packages/process-extract/src/providers/gemini.ts` (~80 lines).
- Create: `packages/process-extract/src/schema-retry.ts` (reflective
  retry on schema parse failure; ~70 lines).
- Create: `packages/process-extract/src/otel.ts` (Gen AI attributes;
  ~50 lines).
- Update: `packages/process-extract/src/index.ts`.
- Create tests: `extract-openai.test.ts`, `extract-anthropic.test.ts`,
  `extract-gemini.test.ts`, `provider-not-installed.test.ts`,
  `otel-attributes.test.ts` per drilldown #8.

Commit: `process-extract: LLM extract with Zod schema + Gen AI OTel`

### Task 11 — `process-classify` impl + tests

Per drilldown #9. Files:
- Create: `packages/process-classify/src/classify-process.ts` (~150 lines).
- Create: `packages/process-classify/src/rule-eval.ts` (~80 lines).
- Update: `packages/process-classify/src/index.ts`.
- Create tests: `rules-mode.test.ts`, `llm-mode.test.ts`,
  `unsupported-mode.test.ts` per drilldown #9.

Commit: `process-classify: rule-based or LLM classifier`

### Task 12 — `process-validate` impl + tests

Per drilldown #10. Files:
- Create: `packages/process-validate/src/validate-process.ts` (~120 lines).
- Update: `packages/process-validate/src/index.ts`.
- Create tests: `validate.test.ts`, `coerce.property.test.ts` per
  drilldown #10.

Commit: `process-validate: Zod boundary validate with coerce mode`

### Task 13 — `process-route` impl + tests

Per drilldown #11. Files:
- Create: `packages/process-route/src/route-process.ts` (~100 lines).
- Update: `packages/process-route/src/index.ts`.
- Create tests: `route.test.ts`, `composition.test.ts` per drilldown #11.

Commit: `process-route: single-priority predicate routing`

### Task 14 — `serve-email` impl + tests

Per drilldown #12. Files:
- Create: `packages/serve-email/src/email-serve.ts` (~150 lines).
- Create: `packages/serve-email/src/providers/smtp.ts` (~80 lines).
- Create: `packages/serve-email/src/providers/postal.ts` (~80 lines).
- Create: `packages/serve-email/src/providers/resend.ts` (~80 lines).
- Update: `packages/serve-email/src/index.ts`.
- Create tests: `smtp-mode.test.ts`, `postal-mode.test.ts`,
  `resend-mode.test.ts`, `provider-not-installed.test.ts` per drilldown #12.

Commit: `serve-email: SMTP / Postal / Resend providers`

### Task 15 — `serve-slack` impl + tests

Per drilldown #13. Files:
- Create: `packages/serve-slack/src/slack-serve.ts` (~180 lines).
- Create: `packages/serve-slack/src/idempotency.ts` (~70 lines for
  cache derivation).
- Update: `packages/serve-slack/src/index.ts`.
- Create tests: `slack-serve.test.ts`, `idempotency-cache.test.ts` per
  drilldown #13.

Commit: `serve-slack: chat.postMessage with idempotency cache`

### Task 16 — `serve-webhook` impl + tests

Per drilldown #14. Files:
- Create: `packages/serve-webhook/src/webhook-serve.ts` (~180 lines).
- Create: `packages/serve-webhook/src/ssrf.ts` (~60 lines).
- Create: `packages/serve-webhook/src/auth.ts` (4 auth modes; ~60 lines).
- Update: `packages/serve-webhook/src/index.ts`.
- Create tests: `webhook-serve.test.ts`, `ssrf.test.ts`,
  `roundtrip.property.test.ts` per drilldown #14.

Commit: `serve-webhook: outbound HMAC webhook with SSRF guard`

### Task 17 — `serve-mcp` impl + tests + provider-install docs

Per drilldown #15. Files:
- Create: `packages/serve-mcp/src/mcp-serve.ts` (~180 lines).
- Create: `packages/serve-mcp/src/tool-registration.ts` (~60 lines).
- Update: `packages/serve-mcp/src/index.ts`.
- Create tests: `mcp-serve.test.ts`, `pipeline-integration.test.ts`
  per drilldown #15.

Plus: `docs/install-providers.md` — single page documenting peerDep
install commands per provider (referenced from `provider_not_installed`
errors in Sections 5.8 / 5.12).

Commit: `serve-mcp: expose pipeline as MCP tool + install docs`

### Task 18 — Spec-text touch-ups (Lock 1 + version drift)

Per Section 0 Lock 1 + M0 OQ-6.

- Edit: `docs/spec-api-surface.md` §"Reviewable<I> (ADR14)" — add note:
  "These types are exported from `@pipeline-kit/core`; re-exported
  alongside `EditableField<T>` and reference impls
  (`GatewerkReviewable`, `ConsoleReviewable`) from
  `@pipeline-kit/process-reviewable` for ergonomic access."
- Edit: `docs/spec-build-plan.md` §3 line 16-22 — update test framework
  versions: "Vitest 4.x" (was "2.x"), "fast-check 4.x" (was "3.x"),
  "tstyche 7.x" (was "(optional v0)"). Note that this is a version-pin
  update, not an ADR15 re-deliberation.

No source/test changes; documentation only.

Commit: `spec: Reviewable canonical-export note + test-framework version pins`

### Task 19 — Coverage gate + per-package READMEs final pass

Run `pnpm test --coverage` across all packages; verify thresholds
80/80/75/80 hit per-package and aggregate. If a package falls below,
add tests, never weaken thresholds (per CLAUDE.md anti-pattern).

Update root `README.md` to reflect M0.5 ship state:
- "v0 status: M0 + M0.5 shipped — 17 packages (core + process-reviewable
  + 15 reference adapters). M1 ships Trades Outbound."
- Quickstart code-block updated to show one full-stack composition
  using a Source + Process + Serve combo (e.g., `apiSource → extract
  → emailServe`).

Per-adapter READMEs verified — each has the 10-15-line minimum.

Run `pnpm lint --apply` + `pnpm format`. Final all-gates run.

Commit: `m0.5: coverage gate green + READMEs + final lint/format pass`

### Task 20 — Smoke

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm test:types

bun install --frozen-lockfile
bun test packages/core/tests/
bun test packages/process-reviewable/tests/
bun test packages/source-api/tests/
bun test packages/store-sqlite/tests/        # bun-mode active here
# (other adapters verified on Bun via vitest's runtime; explicit bun test
# coverage prioritized for runtime-sensitive ones — sqlite + native fetch +
# crypto — full bun matrix coverage in CI)

# Counts:
pnpm vitest run --reporter=json | jq '.numTotalTests'   # >= 425

# Coverage summary:
pnpm test:coverage --reporter=text-summary | tail -30
```

No commit (verification only).

---

## 7. Verification gates

All five green = code-level done:

```
pnpm typecheck            # zero errors across all 17 packages
pnpm lint                 # zero violations
pnpm test                 # all green; thresholds met per-package
pnpm test:types           # all green
bun test                  # runtime-compat smoke on 4+ packages
```

Coverage thresholds (per ADR15 + spec §3): lines >=80%, functions
>=80%, branches >=75%, statements >=80% — per-package and aggregate.
**Add tests** to close gaps; never weaken thresholds.

Test count target: **425+ total** (M0's 231 + ~175 new = ~406+). Per-
package floor: 5 unit minimum; per-adapter property test where the
adapter has an obvious invariant (round-trip, idempotency, schema
preservation). **Quality > quantity** — surface in OPEN QUESTIONS if
naturally <425 with all gates green; do NOT pad.

**Push policy:** do NOT push. Brain authorises after report-back review.

---

## 8. Report-back format

```markdown
## Summary
<1 paragraph: M0.5 ship state, branch + tip, 15 new packages
bootstrapped, total test count, coverage stats, all gates green/red,
Composer fan-out upgrade outcome>

## Tasks completed
- [x] Task 0  — State verified, branch off 7d8fd44
- [x] Task 1  — Composer fan-out (per-atom dispatch)
- [x] Task 2  — Bootstrap 15 adapter package skeletons
- [x] Task 3  — source-api
- [x] Task 4  — source-webhook
- [x] Task 5  — source-apify
- [x] Task 6  — source-mcp
- [x] Task 7  — store-postgres
- [x] Task 8  — store-sqlite
- [x] Task 9  — store-pgvector
- [x] Task 10 — process-extract
- [x] Task 11 — process-classify
- [x] Task 12 — process-validate
- [x] Task 13 — process-route
- [x] Task 14 — serve-email
- [x] Task 15 — serve-slack
- [x] Task 16 — serve-webhook
- [x] Task 17 — serve-mcp + install-providers docs
- [x] Task 18 — Spec-text touch-ups
- [x] Task 19 — Coverage gate + READMEs
- [x] Task 20 — Smoke

## Verification (5 gates)
- pnpm typecheck:    <pass>
- pnpm lint:         <pass>
- pnpm test:         <N tests; lines/func/branch/stmt %>
- pnpm test:types:   <pass / N tstyche assertions>
- bun test:          <pass>

## Test counts
- Unit/integration:  <N>      (target: 350+; M0 198 + new ~150)
- Property:          <N>      (target: 12; M0 5 + new ~7)
- tstyche:           <N>      (target: 30+; M0 24 + new ~6)
- TOTAL:             <N>      (target: 425+)

## Files added (M0.5 only — exclude M0 baseline)
- packages/source-{api,webhook,apify,mcp}/      <N> files / <N> lines
- packages/store-{postgres,sqlite,pgvector}/    <N> files / <N> lines
- packages/process-{extract,classify,validate,route}/  <N> files / <N> lines
- packages/serve-{email,slack,webhook,mcp}/     <N> files / <N> lines
- core/src/composer/ (modifications):           <N> files / <N> lines
- docs/ (touch-ups + install-providers.md):     <N> files

## Branch state
- Branch: m0-5-reference-adapters
- Tip: <short hash>
- Commits: 19 (Task 0 + 20 are verify-only; Tasks 1-19 each one commit)
- Pushed: no (brain authorises)

## Composer fan-out validation
<one paragraph: did Lock 2's option (B) wire end-to-end? are 8 fan-out
tests + 2 property tests green? did per-atom OTel emit verify cleanly?
did per-atom idempotency-key uniqueness hold for arbitrary N?>

## OPEN QUESTIONS
<bullet list — paste any items from Section 10 hit during
implementation, plus anything unexpected (version drift, peerDep
resolution issues, etc.)>
```

---

## 9. Non-goals (explicit — do NOT do these)

- Do NOT ship Trades Outbound or any reference project. **M1**.
- Do NOT ship `Audited<I,O>` / `AuditAdapter` / `AuditEntry`. **M2**.
- Do NOT ship `SlackEmojiReviewable` / `EmailLinkReviewable` /
  `feedback-aware-process` / `enrich-process` / `dedup-process` /
  `summarize-process` / `crm-serve` / Voice/SMS/PDF serves. **v1**.
- Do NOT ship `pursuit-demand-source`. **v1** (uses pursuit-mcp via
  generic mcp-tool-source for now).
- Do NOT ship `@pipeline-kit/composer-{inngest,trigger}` thin
  wrappers. **v1**.
- Do NOT ship `process-extract` provider `'router'` mode. **v1** (router
  needs cost/latency-aware routing; non-trivial; v0 ships per-provider).
- Do NOT add Effect.ts / ArkType / Saga / Outbox. ADR1 / ADR-A / v2.
- Do NOT add marketplace surface or `pk.adapters` resource. **v1+**.
- Do NOT add `child(overrides)` to `PipelineContext`. **v1+**.
- Do NOT add CloudEvents emission mode. **v1** (ADR-D).
- Do NOT unify route-policy. **v1** (ADR-C).
- Do NOT auto-publish to npm in CI. Changesets stays gated until M1.
- Do NOT rename `pk_atom_` / `Atom<T>`. Family-of-products renaming
  question (spec §5 #18) is separate.
- Do NOT push the branch. Brain authorises.
- Do NOT split M0.5 across multiple branches. One branch, one commit
  per Task.
- Do NOT split this brief across multiple files unless line count
  exceeds 1500 (per `feedback_spec_doc_discipline.md`).
- Do NOT add provider SDKs as hard deps. Always peerDep + dynamic
  import + clear `provider_not_installed` error.
- Do NOT add new ADRs. Surface architectural questions in OPEN
  QUESTIONS for brain to lock.

---

## 10. OPEN QUESTIONS FOR BRAIN

> **Brain pre-locks defaults below where applicable. Surface in
> report-back only if executor hits an unresolvable edge case despite
> the locked default. Carries M0 OPEN-QUESTIONS forward where still
> live.**

1. **`process-extract` provider 'router' mode in v0 vs v1.** Spec-
   adapters #8 lists `'openai'|'anthropic'|'gemini'|'router'` as v0.
   Router needs cost/latency/availability-aware fallback; non-trivial
   to implement well in v0 without real production traffic to tune
   against. Default: drop `'router'` from v0; ship per-provider only;
   defer router to v1 alongside multi-provider production data.
   **`Decision: locked-default`** — drop router; v0 ships
   per-provider. Spec-adapters §2 #8 gets a clarifying note in
   future spec-text touch-up (M1 cycle).

2. **`source-mcp` JSON Schema → Zod auto-derivation depth.** MCP tools
   expose JSON Schema for input/output; auto-deriving Zod for
   arbitrary nested schemas is heavyweight. Default: support primitive
   + flat-object derivation; fall back to `z.unknown()` for nested /
   union / advanced shapes; emit warning span; document fallback path
   in package README.
   **`Decision: locked-default`** — primitive + flat-object only; user
   can override with `config.schema` for full-fidelity.

3. **`store-pgvector` Drizzle custom-type pattern stability.** Drizzle
   custom types are a relatively recent ORM feature; v0.30+ series.
   Risk: API churn. Default: implement against current stable; if
   pattern breaks on minor bump, surface in OPEN QUESTIONS for brain
   pin-bump or workaround.
   **`Status: defer-to-executor`** — only answerable at install/test
   time. Brief contingency: if Drizzle custom-type API shifts, executor
   may need to inline the SQL DDL via `sql\`vector(${dim})\`` as
   fallback; surface decision.

4. **`serve-mcp` pipeline-as-MCP-server runtime.** Per ADR22 kit is
   library-not-runtime. The adapter exposes a tool registration object
   (`serve.toolRegistration`) for users to wire into their own MCP
   server. v0 doesn't host an MCP server; users use
   `@modelcontextprotocol/sdk`'s `Server` class themselves.
   **`Decision: locked-default`** — registration-object pattern;
   no kit-side server hosting. Documented in package README quickstart.

5. **`source-apify` schema validation: skip-bad vs error-on-bad item.**
   Default: skip-bad-item with OTel warning, continue iteration —
   matches `feedback_pydantic_boundary_coercion.md` philosophy.
   Alternative: error-out on first bad item.
   **`Decision: locked-default`** — skip-bad-item; per pursuit lesson.

6. **Per-adapter README depth: minimal vs full quickstart.** Default:
   10-15-line minimal (description + install + link to docs).
   Alternative: full quickstart per adapter (~50 lines each — 750 line
   total cost across 15). v0 minimal; M1 expands per-adapter docs
   alongside Trades Outbound dogfood.
   **`Decision: locked-default`** — minimal in M0.5; full quickstarts
   in M1 alongside Trades Outbound.

7. **Carry-forward — pnpm version drift (M0 OQ-4).** Local pnpm 9 vs
   `packageManager` 10.33.4. M0 confirmed lockfile reads cleanly across
   v9-v10. M0.5 inherits the same toolchain; same drift expected.
   **`Decision: locked-default`** — keep `packageManager` 10.33.4;
   executor uses 10.33.4 in CI; local 9 emits notice but works.

8. **Carry-forward — TypeScript narrowing edge case (M0 OQ-5).** M0
   needed `as T` cast in `composer/retry.ts`. M0.5 adds Composer
   modifications (Task 1) that may surface similar narrowing issues.
   Default: prefer explicit cast with comment over discriminator
   restructure; track in tstyche test.
   **`Status: defer-to-executor`** — surface if a new cast is needed;
   add tstyche regression test if so.

9. **`source-webhook` Hono major version.** Hono 4.x is current stable
   as of authoring; Hono 5 may release before/during M0.5 build. If 5
   is current at install time, use it (likely API-compatible per Hono's
   stability record).
   **`Status: defer-to-executor`** — pin to current stable at install;
   surface if breaking API change.

10. **`@google/generative-ai` vs `@google/genai` package name.**
    Google rebranded GenAI SDKs in early 2025. M0.5 may target either
    package depending on current canonical state.
    **`Status: defer-to-executor`** — install whichever is current
    npm-stable; surface drift if both exist.

---

## 11. Coordination with future briefs

After M0.5 ships:

- **M1 brief — Trades Outbound (first reference project; validates
  Loop γ).** Lives in `~/Claude-Workspace/trades-outbound/` consuming
  `@pipeline-kit/*` from local file: links pre-publish or npm
  post-publish. Composes:
  `apify-source` (lead enrichment) →
  `extract-process` (LLM normalisation) →
  `validate-process` (Zod boundary) →
  `classify-process` (route by stake) →
  `route-process` (split by category) →
  `reviewable-wrapper` (HRP via Gatewerk) →
  `email-serve` (outbound) +
  `postgres-store` (audit trail).
  All M0.5 adapters get real production exercise. README + ADR doc +
  hero blog post on idriszade.com.

- **M2 brief — Audited<I,O> + Gatewerk audit log integration.**
  Compliance feature; depends on M1 production traffic to define
  audit-entry schema concretely.

- **HANDOFF.md update** on M0.5 completion: pipeline-kit's HANDOFF
  flips Track A from "M0 shipped, M0.5 brief drafting queued" to
  "M0.5 shipped, M1 brief drafting queued (Trades Outbound)".

- **Spec-text closeouts queued for M1 cycle:** `spec-adapters.md` §2
  #8 `process-extract` removes `'router'` from v0 list (per OQ-1
  here); other v1 adapter list moves wherever needed.

- **OPEN QUESTIONS escalation rule:** any OQ-item this brief lists
  as `defer-to-executor` that surfaces during build → executor adds
  to report-back; brain decides; M0.5 closeout incorporates any
  decisions not blocking M1 brief.

---

*End of M0.5 brief. Estimated 35-50 executor hours across 3-5 sessions.
Branch off `master` tip `7d8fd44`. All gates green = code-level done;
brain authorises push after report-back review.*

*Author: Brain — 2026-05-07.*
*Phase 2 inputs: spec.md (1510 lines) + spec-api-surface.md (262) +
spec-adapters.md (235) + spec-build-plan.md (321).*
*Phase 3 v0 build resumes from this brief.*

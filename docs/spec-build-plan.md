# pipeline-kit — Phase 2 Spec — §3 Test Plan + §4 Roadmap + §5 Deferred

> Drilldown for [spec.md](spec.md). Test framework + property invariants +
> v0/v1/v2 milestones (M0-M5) + portfolio project sequencing + open
> questions deferred to v1/v2 spec authoring + Phase 3 executor notes.
>
> **Author:** Brain — 2026-05-06.

---

## §3 — Test plan + invariants

### Test framework (per ADR15)

- **Unit + integration:** Vitest 4.x.
- **Property:** fast-check 4.x.
- **Type-level:** tstyche 7.x (optional v0; mandatory for `Pipeline.from().through().to()` chainable API type-narrowing tests).
- **Coverage thresholds (CI gate):** 80% lines / 80% functions / 75% branches /
  80% statements. Below = red build.
- **Lint + format:** Biome 2.x.
- **Type-check:** `tsc --noEmit` (strict + noUncheckedIndexedAccess).

### Property-based tests (kit-level invariants)

These properties hold for all v0 adapters:

```typescript
// Source: deterministic given (query, cursor)
fc.assert(fc.asyncProperty(arbQuery, arbCursor, async (query, cursor) => {
  const result1 = await source.fetch(query, cursor);
  const result2 = await source.fetch(query, cursor);
  expect(result1).toEqual(result2);
}));

// Source: iter and fetch produce same data
fc.assert(fc.asyncProperty(arbQuery, arbCursor, async (query, cursor) => {
  const fromIter = await collect(source.iter(query, cursor));
  const fromFetch = await source.fetch(query, cursor);
  expect(fromIter).toEqual(fromFetch.data);
}));

// Store: put is idempotent given same idempotency key
fc.assert(fc.asyncProperty(arbAtom, arbKey, async (atom, key) => {
  const result1 = await store.put({ ...atom, idempotency_key: key });
  const result2 = await store.put({ ...atom, idempotency_key: key });
  expect(result1.data).toEqual(result2.data);
}));

// Store: put().then(get) round-trips Atom integrity
fc.assert(fc.asyncProperty(arbAtom, async (atom) => {
  await store.put(atom);
  const got = await store.get(atom.id);
  expect(got.data).toEqual(atom);
}));

// Process: pure-Process is referentially transparent
fc.assert(fc.asyncProperty(arbInput, async (input) => {
  const result1 = await pureProcess.run(input, ctx);
  const result2 = await pureProcess.run(input, ctx);
  expect(result1).toEqual(result2);
}));

// Serve: emit is idempotent given same idempotency key
fc.assert(fc.asyncProperty(arbInput, arbKey, async (input, key) => {
  const ctx1 = { ...ctx, idempotencyKey: key };
  const ctx2 = { ...ctx, idempotencyKey: key };
  const result1 = await serve.emit(input, ctx1);
  const result2 = await serve.emit(input, ctx2);
  // Both succeed; downstream sees only one effect
  expect(result1.data?.id).toEqual(result2.data?.id);
}));

// Reviewable: preserves I shape on approve
fc.assert(fc.asyncProperty(arbInput, async (input) => {
  const responses = await reviewable.review(input, ctx);
  if (responses.data?.[0]?.decision === 'approved') {
    const approved = responses.data[0].value;
    expect(typeof approved).toBe(typeof input);
  }
}));

// EditableField: invariant
fc.assert(fc.property(fc.string(), (suggested) => {
  const f = Field.unedited(suggested);
  expect(f.approved).toBe(suggested);
  expect(f.wasEdited).toBe(false);
}));

fc.assert(fc.property(fc.string(), fc.string(), (s, a) => {
  fc.pre(s !== a);
  const f = Field.edited(s, a);
  expect(f.wasEdited).toBe(true);
  expect(f.approved).toBe(a);
}));

// Pipeline: cancellation is graceful
fc.assert(fc.asyncProperty(arbPipeline, async (pipeline) => {
  const controller = new AbortController();
  const runPromise = pipeline.run(undefined, { signal: controller.signal });
  controller.abort();
  const result = await runPromise;
  expect(result.error?.type).toBe('cancelled');
}));

// OTel spans: every stage produces a span with parent/child relationship
fc.assert(fc.asyncProperty(arbPipeline, async (pipeline) => {
  const spans = collectSpans();
  await pipeline.run();
  const rootSpan = spans.find(s => s.name === 'pipeline.run');
  const childSpans = spans.filter(s => s.parentId === rootSpan?.id);
  expect(childSpans.length).toBeGreaterThan(0);
}));
```

### Test-suite target

**250+ tests minimum** (outline §12 target), distributed:

- **Unit tests** mirror `src/` structure: ~150 tests across 16 adapters +
  Composer + helpers.
- **Property tests:** ~60 tests covering kit-level invariants (above).
- **Integration tests:** ~30 tests using real adapters (Postgres in Docker,
  Anthropic API live with `[skip-ci]` tag, Slack with mocked transport).
- **Type-level tests (tstyche):** ~10 tests on `Pipeline.from().through().to()`
  chainable type-narrowing.

### PIV Loop 5-layer pyramid mapping (Cole Medin, Cat-I source 7)

Encoded in CLAUDE.md anti-patterns + this spec:

| Layer | Owner | Scope | pipeline-kit instance |
|---|---|---|---|
| **L1 typecheck/lint** | agent | `tsc --noEmit` + `biome check` | CI gate; pre-commit hook |
| **L2 unit + property** | agent | Vitest + fast-check | CI gate; coverage threshold |
| **L3 integration/E2E** | agent + browser | reference-project run | Trades Outbound v0 = L3 E2E |
| **L4 code review** | human + AI | brain reviews PRs | brain authority |
| **L5 manual testing** | human | golden-path + edge cases | Idris dogfood + first-client deployments |

**Goal: push the L3↔L4 line down as far as possible.** Each adapter's
property tests + reference-project integration test cover L3; brain only
reviews L4 conceptual + design issues, not what tests already cover.

---

## §4 — Roadmap (M0 → M2 shipped; M3 current; M4+ deferred)

> Note: v0/v1/v2 version-tier framing removed. The canonical tiering is
> core / primitives / packs / user-glue (4-tier rule). Milestones are
> build increments, not product releases.

### Status as of 2026-05-19

| Milestone | Ship date | Commit | Tests |
|---|---|---|---|
| M0 — Composer + Reviewable<I> + GatewerkReviewable kernel | 2026-05-06 | 7d8fd44 | 231 |
| M0.5 — 15 reference adapters + Composer Source fan-out | 2026-05-07 | 1c340bc (tag: m0.5-shipped) | 435 |
| M0.5b — npm publish; 17 pkgs at `@idriszade/*@0.1.0` via GHA | 2026-05-09 | — | — |
| v0.1.1 — zod4 fix + changesets; process-extract + process-classify bumped | 2026-05-10 | — | — |
| M1 — core v1 foundation: secrets + memory + core extensions; 29 ADRs ratified | 2026-05-15 | a331d6b | 562 |
| M2 — Durable Execution + CLI DX: adapter-inngest + cli + TriggerAdapter; 11 ADRs | 2026-05-15 | 1d412d3 | 709 |

### M3 (current) — Observability + Eval foundation

See forthcoming `docs/briefs/m3_observability_eval.md` for the full executor
brief. Scope summary:

- **Packages:** core extension + `@idriszade/observe` + `@idriszade/observe-vercel`
  + cli (`pk trace` command) + `@idriszade/eval` + `@idriszade/eval-scorers`.
- **ADRs in scope:** Cat X (X-1..X-5) + IX-4 + partial VII-1 + partial II.
- **v1 must-haves closed by M3:** eval (1 of 3); local-prod seam completion
  via `pk trace` (2 of 3 — partially shipped in M2 via `pk dev`).
- **v1 must-have still open after M3:** PII redaction at Zod boundary
  (Cat VIII-6 / VI cross-cut) — deferred to M4.

### M4+ (deferred)

Carry-forwards confirmed out-of-scope for M3:

- Thin adapters: `secrets-env`, `secrets-sops`, `secrets-oidc`, `memory-map`.
- `@idriszade/cost` pricing pack (ADR X-4; cross-attempt cumulative budget
  tracking cf-X-4).
- PII redaction at Zod boundary (Cat VIII-6 / VI cross-cut) — third v1 must-have.
- Python wire codegen (ADR IX-2).
- M2 CLI carry-forwards: `stdin` for `pk run`, webhook local trigger for
  `pk dev`, full cron parsing, `pk scaffold`.

Portfolio-project sequencing removed — kit is personal toolkit, not a launched
product. Constellation projects are example use cases per the 4-tier rule, not
milestone triggers.

---

## §5 — Open / deferred questions

These are explicitly NOT in v0; documented for Phase 3 + v1 spec authoring.

### Deferred to v1 spec

1. **ADR-C — Route-policy shape (stakes / confidence / priority unification).**
   Phase 1 brain Q5 lock: real route complexity not present in v0 reference
   projects; v0 ships single-priority routing (`route-process` adapter).
   v1 spec adds unified route-policy ADR after Multi-CRM Sync surfaces real
   complexity.

2. **ADR-D — CloudEvents emission mode for `webhook-serve`.**
   Phase 1 brain Q6 lock: Stripe-shape default in v0 (per Gatewerk catalog);
   CloudEvents-shape opt-in deferred to v1 for AWS EventBridge / Knative
   interop. v1 spec adds CloudEvents adapter ADR.

3. **Auto-MCP exposure code-gen** (Phase 1 Q7). v0 ships runtime piece
   (`mcp-tool-serve` adapter); v1 ships codegen tooling that automatically
   generates MCP server from a `Pipeline.describe()` definition.

4. **ArkType escape hatch** (Phase 1 Q5 + Cat-VI Q1). v0 stays on Zod;
   v1 profiles real-world hot paths and adds optional ArkType for validation-
   bound stages if profiling shows benefit.

5. **`feedback-aware-process` adapter** (outline §11 v1). v1 spec details
   the Gatewerk feedback-API integration pattern; depends on M3 (cross-pipeline
   feedback memory).

6. **Inter-agent reviews (outline §8 #11)** — two pipelines reviewing each
   other's outputs through Gatewerk. Architecture pattern documented in
   v1 spec; v0 supports this via Reviewable composition but doesn't ship a
   reference impl.

7. **`pk.adapters` runtime resource** (industry-alignment redline ADR23).
   v0 has no marketplace or dynamic-registration use case; adapter
   registration is construction-time per industry standard (Drizzle, tRPC,
   Inngest, Pydantic AI). v1 spec adds `pk.adapters` if marketplace surface
   or dynamic-registration emerges.

8. **`@idriszade/composer-inngest` + `@idriszade/composer-trigger`
   thin wrapper packages** (industry-alignment redline ADR22). Per
   industry-standard integration-package pattern (Drizzle dialects, LangChain
   integrations). v1 ships these alongside the M2 milestone work; v0 omits
   to keep kit-core minimal.

9. **PipelineContext `child(overrides)` for sub-pipelines**
   (industry-alignment redline ADR5). Cut from v0 per YAGNI; library-side
   norm (Inngest/Trigger.dev/Hatchet) doesn't pre-ship. Add when concrete
   v1 use case lands (likely tied to nested-pipeline composition).

### Deferred to v2 spec

7. **Effect.ts adoption re-evaluation (ADR1 trigger).** v2 spec inherits this
   ADR's revision; cascade-impact analysis after first 2-3 portfolio projects
   ship.

8. **Saga orchestration for multi-system writes.** Per ADR3 + Cat-V Q3.
   Outline §11 lists in v2.

9. **Durable Composer (Inngest-backed) as a kit-shipped adapter** (vs v1's
   "documentation pattern"). v2 evaluates whether kit-shipped adapter adds
   enough value over docs-only pattern.

10. **Cloud-managed pipeline-kit hosting** (parallel to Gatewerk Cloud).
    v2 product question; not a kit-core concern.

### Documented for executor (Phase 3)

13. **Per-adapter migration scripts** — every Store adapter ships
    `migrations/0001_init.sql` minimum; brain reviews schemas before M0.5.

14. **HRP v1 spec compliance testing** — Reviewable adapters MUST conform to
    HRP v1; conformance tests live in `tests/hrp/`. Phase 3 task.

15. **CI matrix** — Node 20 + 22 LTS + Bun latest. Per-PR runs for all three.
    Phase 3 spec.

16. **Package publish layout** — monorepo via `pnpm` workspaces; `changesets`
    for versioning; auto-publish on merge to main with version bumps in
    changesets. Phase 3 spec.

17. **Pipeline input typing** — `Pipeline<Input, Output>` generic over both
    (per ADR12 redline). Pipelines starting from a no-input Source infer
    `Input = void` and call `pipeline.run()`; pipelines from a Source taking
    external query infer `Input = SourceQuery` and call `pipeline.run(query)`.
    Executor brief locks the precise generic inference.

### Family-of-products consideration (deferred separate decision)

18. **`atoms` resource and `pk_atom_` ID prefix renaming.** Industry vocabulary
    leans toward `events` (Inngest, CloudEvents) or `records` (DB-flavored)
    for the per-stage data unit; "atom" is family-internal vocabulary.
    Renaming cascades into CLAUDE.md prefix change, outline §11 references,
    and Atom<T> type rename. Worth a separate brain decision after first
    M0 build pass when concrete user-facing reactions surface; not bundled
    into v0 spec lock.

---

*End of §3 + §4 + §5. See [spec.md](spec.md) for ADRs 1-23,
[spec-api-surface.md](spec-api-surface.md) for §1 API surface,
[spec-adapters.md](spec-adapters.md) for §2 reference adapter list.*

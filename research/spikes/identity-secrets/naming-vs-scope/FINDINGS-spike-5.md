# Cat VIII Spike #5 leg-2 sub-(1) — `naming-vs-scope` Findings

> Spike: a 2-cell TS spike that runs a two-stage, two-secret pipeline
> (`Source(apify) → Store(supabase)`) under a single shared
> `createVersionAwareResolver(real)` instance, with two call-site shapes
> (flat naming vs structural scope) — under the leg-1 verdict
> (`B + version-aware-resolver` as the kit default).
> Branch: `v1-cat-VIII-spike-5-naming-vs-scope`. Author: Executor —
> 2026-05-09. Forked from spike #4 leg-1 (master tip c191861).
> Companion to: `docs/research-outline-v1.md` § Category VIII (Identity /
> Secrets) Q4.
> Status: spike output (NOT a notes file; brain synthesises a
> notes-v1-cat-VIII.md later).
> Friction anchor: `F-AUTH` — top-15 #2, 9/9 universality.
> Sub-questions (2) (deps-shape) and (3) (variant C re-entry) are OUT
> OF SCOPE for this leg.

## 1. WHAT WAS BUILT

A 2-cell spike forking leg-1 fixtures verbatim and adding ONE wrapper
extension + ONE new fixture:

- **`version-aware-resolver.ts` (114 LOC).** Forked from leg-1 (65 LOC)
  and extended in place with `scope(prefix)`. The leg-1 contract
  (resolve / invalidate / stats) is unchanged. New `scope(prefix)`
  returns a `ScopedSecretsResolver`-shaped sub-view; the sub-view's
  `resolve(name)`, `stats(name)`, and `invalidate(name)` forward to
  the parent wrapper's same methods with the **composite name** =
  `${prefix}-${name}` (hyphen joiner — matches the existing kit-shape
  `NAME_RE` `^[a-z0-9][a-z0-9-]*$`). The cache map lives **on the
  parent wrapper instance only**. The sub-view is a thin façade that
  does name-composition; it does NOT own its own cache. This is THE
  design choice the spike is testing — documented as such in the file
  header.
- **`mock-supabase-store.ts` (69 LOC).** New Store-shaped stub that
  matches the spec API surface (`id` + `put(atom, ctx)`); schema/
  get/list dropped as out of spike scope. Factory takes a resolved
  `serviceRoleKey: string`, closes over it, prints
  `[supabase-store] UPSERT atom=...` per put. No real Supabase / no
  real network.
- **Shared fixtures: `mock-secrets-resolver.ts` (118 LOC) and
  `mock-apify-http-client.ts` (85 LOC).** Bit-identical forks of
  leg-1. The mock resolver already registered both `apify-token` AND
  `supabase-service-role` v1; under the hyphen-joiner both names
  compose cleanly under scope. No fixture changes needed.
- **Cell (e) — flat hyphenated naming (`cell-e-flat.ts`, 178 LOC).**
  Source(apify) factory calls `secrets.resolve('apify-token')` (factory
  + per-request signer — two-site under B.2 shape); Store(supabase)
  factory calls `secrets.resolve('supabase-service-role')` (single-site
  at factory). Pipeline emits 2 atoms via Source, each ingested via
  Store. Read counts on the underlying real resolver logged at
  initial / post-factory / after each atom / final.
- **Cell (f) — structural scope (`cell-f-structural.ts`, 179 LOC).**
  Source(apify) factory calls `deps.secrets.scope('apify').resolve('token')`
  (factory + per-request signer — same two-site shape, scoped sub-view
  cached in factory closure for re-use across signer calls);
  Store(supabase) factory calls
  `deps.secrets.scope('supabase').resolve('service-role')`. Same
  pipeline shape, same atom + observation cadence as cell (e).
- **Run script (`run-spike-5.sh`, 31 LOC).** Mirrors leg-1's
  `run-spike-4.sh` — node strip-types direct (Node 22+), bun fallback;
  two cells in sequence with section headers between.

## 2. THE TWO CELL TRACES

Verbatim run output (from `bash run-spike-5.sh`):

### 2.1 Cell (e) — flat hyphenated naming

```
==> [1/2] Cell (e) — flat hyphenated naming
### CELL (e) — flat hyphenated naming, two-stage two-secret pipeline ###
[cell-e] initial (real) apify-token reads=0 current_version=v1
[cell-e] initial (real) supabase-service-role reads=0 current_version=v1
[cell-e] post-factory (real) apify-token reads=1 current_version=v1
[cell-e] post-factory (real) supabase-service-role reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=5cafe392f52409e2 atom=pk_atom_CELL_E_01
[cell-e] atom 1 source OK id=pk_atom_CELL_E_01 call_id=5cafe392f52409e2
[supabase-store] UPSERT atom=pk_atom_CELL_E_01 run=run_cell_e service_role=sb-srv-v1 job_id=apify_run_pk_atom_CELL_E_01
[cell-e] after-atom-1 (real) apify-token reads=1 current_version=v1
[cell-e] after-atom-1 (real) supabase-service-role reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=7de3e8bb73e68c90 atom=pk_atom_CELL_E_02
[cell-e] atom 2 source OK id=pk_atom_CELL_E_02 call_id=7de3e8bb73e68c90
[supabase-store] UPSERT atom=pk_atom_CELL_E_02 run=run_cell_e service_role=sb-srv-v1 job_id=apify_run_pk_atom_CELL_E_02
[cell-e] after-atom-2 (real) apify-token reads=1 current_version=v1
[cell-e] after-atom-2 (real) supabase-service-role reads=1 current_version=v1
[cell-e] final (real) apify-token reads=1 current_version=v1
[cell-e] final (real) supabase-service-role reads=1 current_version=v1
```

### 2.2 Cell (f) — structural scope

```
==> [2/2] Cell (f) — structural scope
### CELL (f) — structural scope, two-stage two-secret pipeline ###
[cell-f] initial (real) apify-token reads=0 current_version=v1
[cell-f] initial (real) supabase-service-role reads=0 current_version=v1
[cell-f] post-factory (real) apify-token reads=1 current_version=v1
[cell-f] post-factory (real) supabase-service-role reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=f6ac8966eb516dbe atom=pk_atom_CELL_F_01
[cell-f] atom 1 source OK id=pk_atom_CELL_F_01 call_id=f6ac8966eb516dbe
[supabase-store] UPSERT atom=pk_atom_CELL_F_01 run=run_cell_f service_role=sb-srv-v1 job_id=apify_run_pk_atom_CELL_F_01
[cell-f] after-atom-1 (real) apify-token reads=1 current_version=v1
[cell-f] after-atom-1 (real) supabase-service-role reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=2e35ab6fdbdef9e9 atom=pk_atom_CELL_F_02
[cell-f] atom 2 source OK id=pk_atom_CELL_F_02 call_id=2e35ab6fdbdef9e9
[supabase-store] UPSERT atom=pk_atom_CELL_F_02 run=run_cell_f service_role=sb-srv-v1 job_id=apify_run_pk_atom_CELL_F_02
[cell-f] after-atom-2 (real) apify-token reads=1 current_version=v1
[cell-f] after-atom-2 (real) supabase-service-role reads=1 current_version=v1
[cell-f] final (real) apify-token reads=1 current_version=v1
[cell-f] final (real) supabase-service-role reads=1 current_version=v1
```

### 2.3 Read-count + token_seen ledger

Both cells, every observation point:

| Step                                        | cell (e) flat — `apify-token` / `supabase-service-role` | cell (f) scope — `apify-token` / `supabase-service-role` |
| ------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| initial (real) reads / version              | 0 / v1  ;  0 / v1                                       | 0 / v1  ;  0 / v1                                        |
| post-factory (real) reads / version         | 1 / v1  ;  1 / v1                                       | 1 / v1  ;  1 / v1                                        |
| after-atom-1 (real) reads / version         | 1 / v1  ;  1 / v1                                       | 1 / v1  ;  1 / v1                                        |
| after-atom-2 (real) reads / version         | 1 / v1  ;  1 / v1                                       | 1 / v1  ;  1 / v1                                        |
| final (real) reads / version                | 1 / v1  ;  1 / v1                                       | 1 / v1  ;  1 / v1                                        |
| `bearer=` token observed in apify-http POST | `apify-tok-v1`                                          | `apify-tok-v1`                                           |
| `service_role=` observed in supabase UPSERT | `sb-srv-v1`                                             | `sb-srv-v1`                                              |

The two diagnostics that matter:

- **Read-count ledger byte-identical.** Every observation point matches
  cell (e) ↔ cell (f). Both cells end at `apify-token reads=1` and
  `supabase-service-role reads=1`. The wrapper's per-name cache absorbs
  every `resolve()` after the first per name — including the per-request
  signer's call inside the Source — under both flat and scoped call
  sites. By construction.
- **Token strings observed identical.** `apify-tok-v1` bearer at both
  Source HTTP calls in both cells; `sb-srv-v1` service-role at both
  Store UPSERTs in both cells. Composite-name routing produces the
  same value because it lands on the same cache entry.

The `call_id` HMAC digests differ because the signer feeds atom IDs
that differ between cells (`pk_atom_CELL_E_*` vs `pk_atom_CELL_F_*`);
this is naming noise, not a behavioural divergence.

## 3. WHAT THE EVIDENCE SHOWS

### 3.1 Cell (e) — flat hyphenated naming

- **Read collapse?** *Yes — same as leg-1 cell (b) extended to two
  secrets.* `apify-token` reads=1 across factory + 2 signer calls;
  `supabase-service-role` reads=1 across one factory call. The wrapper
  collapses per-call resolves to one underlying read per name per
  version, identically to the single-secret leg-1 finding. Multi-secret
  does NOT inflate reads under the wrapper.
- **Discoverability?** *Names are flat strings; no type-level signal
  that an adapter consumes secrets in a particular namespace.* Cell (e)
  has two factory call sites (`createApifySource` and
  `createSupabaseStore`), each documenting which name it consumes via
  the literal string argument. To find every consumer of any
  `apify-*` secret, a user greps for `'apify-` (or `secrets.resolve`).
- **Composition tax?** *Zero.* No façade construction; each call site
  is a single `secrets.resolve(name)` invocation. Adapter author
  authors a string literal.

### 3.2 Cell (f) — structural scope

- **Read collapse?** *Yes — observably identical to cell (e).* Same
  ledger, same reads=1 per name, same token strings. The composite-name
  forwarding (sub-view → parent wrapper with `${prefix}-${name}`) lands
  on the same cache entries; runtime behaviour is byte-identical by
  construction.
- **Discoverability?** *Mixed.* The factory's first line
  (`const apifySecrets = deps.secrets.scope('apify')`) makes the
  namespace structural — TS types it as `ScopedSecretsResolver`,
  consumers can be grepped via `scope('apify')`. But the suffix names
  (`'token'`, `'service-role'`) are still string literals; the type
  system does not constrain them. Discoverability is partially
  type-level (the prefix) and partially string-level (the suffix) —
  versus cell (e), where it is uniformly string-level.
- **Composition tax?** *One construction line per consumer + one extra
  type import (`ScopedSecretsResolver`).* The factory holds a sub-view
  reference for re-use across the signer closure (otherwise each
  signer call would construct a new sub-view, which is observably
  cheap but stylistically ugly). Tax is small but non-zero — and it
  asks the adapter author a question they did not have to answer in
  cell (e): "is the sub-view itself worth caching in this closure?"

### 3.3 Cross-cell

- **Runtime collapse is total** on every observable in this spike's
  scope. The composite-name design eliminates any runtime distinction
  between flat and scoped call sites by construction.
- **Type-level discoverability is partially gained** by scope at the
  factory's first line, partially lost again at the suffix level.
- **Composition tax** is small but real: one extra binding +
  one extra type import per scoped consumer.
- **Adapter author ergonomics**: cell (e) is "one line to resolve";
  cell (f) is "two lines (scope + resolve) to resolve, plus a closure-
  cache decision". On a single-secret-per-stage adapter, cell (e)
  wins on flat ergonomics. The case for cell (f) would have to come
  from N-secrets-in-one-adapter, which is exactly sub-question (2)
  (deps-shape) — not probed here.

## 4. DOES STRUCTURAL SCOPE PROVIDE ERGONOMIC OR DISCOVERABILITY VALUE OVER FLAT NAMING?

**Headline answer (Q4 verdict at this leg's resolution): NO clear
empirical value beyond what flat naming already provides — under the
scope shape this spike locked.**

Three observations driving this:

1. **Runtime observables collapse by construction.** Cells (e) and (f)
   produce byte-identical read counts and token strings — because the
   sub-view is a name-composition façade that lands on the same parent
   cache. Q4 cannot be decided on runtime grounds: there are none.

2. **Discoverability is partially gained, partially lost.** The
   `scope('apify')` line is a type-level pin for "this adapter consumes
   apify-* secrets" (greppable, type-checked). But the suffix
   (`'token'`) is still a string literal — the kit's `NAME_RE` does
   not distinguish flat names from suffixes, so the suffix space is
   identical in both cells. Net discoverability gain over flat is
   marginal at single-secret-per-adapter scale: flat's
   `'apify-token'` is just as greppable as scope's
   `scope('apify').resolve('token')`.

3. **Composition tax is small but nonzero.** Cell (f) requires one
   extra import (`ScopedSecretsResolver`), one extra binding per
   factory (the sub-view), and asks the adapter author a closure-cache
   question. Cell (e) does none of this. Tax is real on the adapter
   authoring side; whether it amortises depends on N-secrets-per-
   adapter, which sub-question (2) probes — not this leg.

**What Q4 ADR can defensibly say at synthesis (this leg's input):**

> "Under `B + version-aware-resolver`, the kit's default secret-naming
> shape SHOULD be flat hyphenated names (`apify-token`,
> `supabase-service-role`). Structural scope (`scope('apify').resolve(
> 'token')`) provides no runtime value over flat names, because a sub-
> view shares the parent's cache by composite-name forwarding. Scoped
> sub-views MAY be offered as a cosmetic convenience for adapters that
> consume multiple secrets from one namespace, BUT the empirical case
> for that affordance is contingent on sub-question (2) (deps-shape
> under multi-secret) — not yet probed."

That is the strongest statement supportable by this spike's evidence.
It does not foreclose scope as a kit affordance; it places the
burden of proof for it on a future spike (sub-question 2 or beyond).

## 5. PER-CELL SCORECARD

| Dimension                      | cell (e) flat                    | cell (f) structural scope                    |
| ------------------------------ | -------------------------------- | -------------------------------------------- |
| read collapse (per-name)       | reads=1 per name per version     | reads=1 per name per version (identical)     |
| token observed                 | `apify-tok-v1` / `sb-srv-v1`     | `apify-tok-v1` / `sb-srv-v1` (identical)     |
| call sites per factory         | 1 (`resolve(name)`)              | 2 (`scope(p)` + `resolve(suf)`)              |
| type-level namespace pin       | none (string only)               | partial (`ScopedSecretsResolver` at scope()) |
| suffix discoverability         | n/a (flat)                       | string-level only                            |
| composition tax                | 0                                | 1 import + 1 binding + 1 closure question    |
| recursive-scope support        | n/a                              | yes (untested in this leg)                   |
| cache fork (per-scope cache)   | n/a                              | NO — sub-view shares parent cache by design  |
| author-question count          | 1 ("which name?")                | 2 ("which scope?", "cache the sub-view?")    |

The table's only divergent column is **composition tax** plus the
adjacent **author-question count**. Every behavioural column collapses.

## 6. Q4 ADR NARROWING ASSESSMENT

Spike #1 §8 carry-fwd Q4 framed the question as: *"Multi-secret
pipelines + scoping. Naming-convention vs structural-scope. Does
`secrets.scope('apify')` belong on the resolver, or is hierarchical
naming (`apify.token`, `apify-token`) sufficient?"* This spike's
evidence narrows that to:

- **Flat hyphenated naming is sufficient at the kit-default level.**
  Empirical: cell (e) already produces the optimal read-count + token
  ledger, with the smallest call-site footprint and zero composition
  tax. The kit's default-resolver-shape proposal can be: *adapters
  call `secrets.resolve(name)` with a flat hyphenated name; the
  version-aware wrapper handles caching*.
- **Structural scope is NOT necessary** to get optimal runtime
  behaviour, NOT necessary to disambiguate names (flat hyphenated
  names already disambiguate by `${namespace}-${suffix}` convention),
  and NOT necessary for discoverability (greppable strings are
  enough at single-secret-per-adapter scale).
- **Structural scope MAY still be useful** under a use case this leg
  did NOT probe: multi-secret-per-adapter ergonomics
  (sub-question 2), or cross-adapter shared scope objects passed
  around as deps (e.g. an `apifySecrets: ScopedSecretsResolver`
  shared between Source and a hypothetical Serve). Brain should keep
  scope on the table as an OPTIONAL kit affordance — not the default.

**Direction the ADR leans:** flat hyphenated naming as the kit default;
`scope(prefix)` as an optional convenience layered on the resolver
wrapper, **not promoted to a kit-shape requirement** unless a future
leg surfaces a compelling case.

**What firms up vs stays open:**

- **Carry-forward #4 (multi-secret pipelines + scoping) — REFINED, NOT
  YET RESOLVED.** This leg's evidence resolves the *runtime question*
  ("does scope change behaviour?" — no) and the *discoverability
  question* at single-secret-per-adapter scale ("does scope
  meaningfully improve discoverability?" — marginal). It does NOT
  resolve the *deps-shape question* ("does the user write
  `{ secrets: { apify: ..., supabase: ... } }` or one flat
  resolver?") — that is sub-question (2) territory.
- **Carry-forwards #7 / #8 / #11 — UNCHANGED, see §7.**

The kit-shape sentence brain can now defensibly write: *"Default
secret-naming shape is flat hyphenated names. `scope(prefix)` is an
optional façade that produces the same runtime observables; brain
should not promote it to default until sub-question (2) provides
empirical justification."*

## 7. CARRY-FORWARD UPDATES

Re-listing leg-1 §7 carry-forwards (#1–11) with status updates from
this leg's evidence.

1. **Rotation semantics.** **UNCHANGED.** Rotation is not exercised
   in this leg (single-version run). `invalidate(name)` remains
   load-bearing. Multi-secret rotation interplay is explicitly out
   of scope per §9.

2. **Cache scope as ADR.** **REFINED.** This leg confirms a wrinkle:
   the wrapper instance owns ALL cached secrets across all scopes (no
   per-scope cache forking by design). Brain should phrase the ADR as
   "cache lives on the resolver wrapper instance; scopes are
   name-composition façades that share the parent cache".

3. **SOPS / file-backed resolver ergonomics.** **UNCHANGED.** Mock-only.

4. **Multi-secret pipelines + scoping.** **REFINED — runtime
   question resolved; deps-shape question carries.** This leg
   resolves the runtime axis (no behavioural divergence between flat
   and scope) and the discoverability axis at single-secret-per-
   adapter scale (marginal gain). The deps-shape axis (sub-question
   2) remains open.

5. **Construction-time secrets.** **UNCHANGED.** Spike #3's verdict
   stands; this leg preserves the two-site Source shape.

6. **Stage-typed Secrets vs ambient ctx vs deps.** **UNCHANGED.**

7. **Version-aware resolver default.** **UNCHANGED — RESOLVED-ADOPT.**
   Leg-1's verdict stands. This leg uses the wrapper unmodified
   (wrapper extension is additive — `scope()` is purely sub-view
   construction; no changes to resolve/invalidate/stats semantics).

8. **Adapter reconstruction as a Composer concern.** **UNCHANGED — narrow
   scope.** Leg-1's narrow scope (non-re-readable resources only)
   stands. This leg's atoms-are-strings consumers stay in the
   re-readable column.

9. **Async factory ergonomics.** **UNCHANGED.** Both factories in
   this leg are async (Source factory awaits `resolve('apify-token')`;
   Store factory awaits `resolve('supabase-service-role')`). Same
   pattern as leg-1.

10. **Two-site contract in adapter docs.** **UNCHANGED.** Source
    factory still has factory-time + run-time sites for `apify-token`;
    Store factory has factory-time only.

11. **Wrapper composition with TTL / push-rotation layers.** **REFINED.**
    The leg-1 wrapper is now extended with `scope()`. Brain should
    note that any future TTL-resolver / push-resolver wrapper layered
    above or below the version-aware-resolver MUST decide whether it
    composes with `scope()` or only with the flat resolver shape.
    `createTtlResolver(createVersionAwareResolver(real), ttlMs)`
    presumes the inner wrapper exposes only `SecretsResolver` —
    `scope()` is on the outer surface here. This is a small wrinkle;
    not blocking.

**New carry-forward from this leg:**

12. **Composite-name joiner choice.** This leg locks the joiner as
    hyphen (`-`) to match the existing kit-shape `NAME_RE`. If brain
    later wants dotted names (`apify.token`) for hierarchical
    composition, the regex must change AND the joiner becomes
    configurable. This is a kit-shape decision, not a wrapper
    decision — flag for synthesis. Out of scope for this leg.

## 8. WHAT SYNTHESIS + LEG-3 MUST ANSWER

### Sub-question (2) — deps-shape under multi-secret (next leg)

The deps-shape question is the load-bearing one this leg did NOT
answer: when an adapter consumes 3+ secrets from 2+ namespaces, does
the user write `{ secrets: oneFlatResolver }` (this leg's pattern) or
`{ secrets: { apify: scopedView, supabase: scopedView } }`? The
ergonomic case for `scope()` collapses or stands depending on this
answer. Spike scope: build a Source that needs `apify-token` +
`apify-actor-id` + `apify-webhook-secret`, run it under both
deps shapes, observe call-site density and discoverability under
N-secrets-per-namespace.

### Sub-question (3) — variant C re-entry under multi-secret

Spike #3 §7 said C re-entry is NOT triggered by spike #3's evidence.
This leg does not re-trigger it either — runtime collapse means C's
"composition tax under multi-secret" framing has no fresh ammunition.
But sub-question (2) might. Defer the re-entry decision to after
sub-question (2) lands.

### What carries to synthesis vs needs more spikes

**Now answerable at synthesis (no further spike needed):**

- Q4 partial verdict — see §6. Flat hyphenated naming as default;
  `scope()` as optional convenience.
- Carry-forward #2 (cache scope) — narrow refinement: cache lives on
  the wrapper instance; sub-views share parent cache.

**Still needs evidence (leg-3 / sub-question 2 candidates):**

- Carry-forward #4 deps-shape axis — sub-question (2). Likely the
  next dispatch.
- Carry-forward #11 TTL/push composition — could be a spike or could
  be answered at synthesis if brain locks "pull-only via stats is
  the kit's default".
- Carry-forward #12 joiner choice — kit-shape decision, not a spike.

### What synthesis still needs from leg-3 evidence (out of this dispatch)

- Whether multi-secret-per-adapter call-site density justifies
  `scope()` as a kit-default affordance vs an optional façade.
- Whether deps-as-flat-resolver vs deps-as-scoped-bag changes adapter
  authorability under N-secrets-per-namespace.
- Whether sub-question (3) C re-entry is triggered by deps-shape
  evidence (it is not by this leg's evidence).

## 9. HONEST SCOPE BOUND

This leg did NOT probe:

- **Sub-question (2) — deps-shape under multi-secret.** Single
  Source + single Store; one secret per stage. Deferred.
- **Sub-question (3) — variant C re-entry.** Spike #3 §7 said NOT
  triggered; this leg inherits that verdict.
- **Webhook-Serve fixture.** No Serve stage in this leg; HMAC signing
  is not exercised. Cat VIII Q5 is untouched.
- **HMAC signing for webhooks.** The mock Apify HTTP client uses
  HMAC for `call_id` minting (carried from leg-1 fixture), but this
  is a per-call signature, not a webhook envelope auth probe.
- **Per-scope cache forking.** Sub-view shares parent cache by
  design (this leg's locked shape). Whether per-scope cache forks
  ever make sense is a future kit-shape question.
- **Dotted-name regex extension.** Hyphen-only joiner; kit
  `NAME_RE` unchanged.
- **Multi-secret rotation interplay.** No `invalidate(name)` calls in
  this leg. Whether rotating one of two secrets mid-run interacts
  weirdly with scope-shared caches is untested. Carry-forward.
- **Recursive scopes.** Wrapper supports `scope().scope()` (composes
  prefixes), but no harness drives it.
- **Async scope construction.** `scope()` is sync; whether async
  scope construction is ever needed (e.g. lazy-loading a SOPS
  namespace) is untested.
- **Real backends.** Mock-only.
- **Concurrent `resolve()` calls.** Single-threaded JS event loop,
  single-atom-at-a-time harness; no thundering-herd / stampede
  protection probed.
- **Cross-cell race / shared mock.** Each cell constructs its own
  `createMockSecretsResolver()` instance; no cross-contamination.

What this leg DID empirically establish: under
`B + version-aware-resolver` extended with a sub-view-sharing
`scope(prefix)` façade, multi-secret pipelines (Source(apify) →
Store(supabase)) collapse to byte-identical read-count + token-string
ledgers under flat naming and structural scope. The Q4 ADR can
defensibly default to flat hyphenated naming and treat structural
scope as an optional façade pending sub-question (2) evidence.

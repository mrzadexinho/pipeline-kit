# Cat VIII Spike #6 leg-3 — `deps-shape` Findings

> Spike: a 2-cell TS spike that runs a Source(apify) factory consuming
> 3 secrets in the apify namespace under a single shared
> `createVersionAwareResolver(real)` instance, with two deps shapes
> (flat single resolver / multi-resolve vs scoped sub-resolver in deps)
> — under leg-1's verdict (`B + version-aware-resolver`) and leg-2's
> verdict (flat hyphenated naming default; `scope()` optional façade).
> Branch: `v1-cat-VIII-spike-6-deps-shape`. Author: Executor —
> 2026-05-09. Forked from spike #5 leg-2 sub-(1) (master tip 12bfeb1).
> Companion to: `docs/research-outline-v1.md` § Category VIII (Identity /
> Secrets) Q4. Friction anchor: `F-AUTH` (top-15 #2, 9/9 universality).
> Status: spike output (NOT a notes file; brain synthesises a
> notes-v1-cat-VIII.md later, post-leg-3).
> OUT OF SCOPE: cell (2) — flag-only § 5; sub-question (3) C re-entry;
> Webhook-Serve fixture; HMAC envelope generalisation; per-scope cache
> forking; multi-secret rotation interplay; cross-namespace mixed
> cardinality.

## 1. WHAT WAS BUILT

A 2-cell spike forking spike-#5 fixtures with surgical extensions; no
new wrapper file; no Store stage (Source-only at N=3).

- **`version-aware-resolver.ts` (114 LOC).** Forked **VERBATIM** from
  spike #5. NOT modified.
- **`mock-secrets-resolver.ts` (137 LOC).** Forked from spike #5
  (118 LOC) + 2 new registrations: `apify-actor-id` v1 (base
  `apify/web-scraper`) and `apify-webhook-secret` v1 (base
  `apify-whsec-v1`). Existing `apify-token` and `supabase-service-role`
  kept verbatim; supabase is harmless dead weight here. Result /
  SecretsError shapes / NAME_RE / async resolve behaviour bit-identical
  with spike #5 — read counts directly comparable.
- **`mock-apify-http-client.ts` (119 LOC).** Forked from spike #5
  (85 LOC); `ApifyHttpClientFactoryOpts` extended to take `actorId` and
  `webhookSecret` at construction (`actorId` was previously per-request).
  `webhookSecret` is closed-over but NOT invoked per-request; presence
  -in-scope is the only requirement. `mintWebhookDigest` exported
  alongside `mintCallId`; harness does NOT call it. New
  construction-time trace line
  `[apify-http] client built bearer=<...> actor=<...> webhook_secret_tail=<...>`.
  Per-request `signRequest` and `mintCallId` unchanged.
- **`cell-1-flat.ts` (176 LOC).** New; cell-e shape extended to N=3.
  Factory takes `deps: { secrets: SecretsResolver }`; calls
  `secrets.resolve(name)` 3× at factory (`apify-token`,
  `apify-actor-id`, `apify-webhook-secret`) and once per atom in the
  signer (`apify-token`). Two atoms; stats logged at initial /
  post-factory / after each atom / final for all 3 names.
- **`cell-3-scope.ts` (181 LOC).** New; cell-f shape extended to N=3.
  Driver constructs `apifySecrets = wrapped.scope('apify')` at the DI
  boundary BEFORE the factory call. Factory takes
  `deps: { apifySecrets: ScopedSecretsResolver }`; calls
  `apifySecrets.resolve(suffix)` 3× at factory (`token`, `actor-id`,
  `webhook-secret`) + once per atom in signer.
- **`run-spike-6.sh` (34 LOC).** Mirrors spike-#5 runner verbatim only
  with file names changed; node strip-types direct (Node 22+).
- **No `mock-supabase-store.ts`** — leg-3 is Source-only by brief.

**Cell (2) NOT BUILT.** See § 5 for the structural disqualification.

## 2. THE TWO CELL TRACES

Verbatim run output (from `bash run-spike-6.sh`).

### 2.1 Cell (1) — flat / single resolver, multi-resolve

```
==> [1/2] Cell (1) — flat / single resolver, multi-resolve
### CELL (1) — flat / single resolver, multi-resolve, Source(apify) at N=3 ###
[cell-1] initial (real) apify-token reads=0 current_version=v1
[cell-1] initial (real) apify-actor-id reads=0 current_version=v1
[cell-1] initial (real) apify-webhook-secret reads=0 current_version=v1
[apify-http] client built bearer=apify-tok-v1 actor=apify/web-scraper webhook_secret_tail=c-v1
[cell-1] post-factory (real) apify-token reads=1 current_version=v1
[cell-1] post-factory (real) apify-actor-id reads=1 current_version=v1
[cell-1] post-factory (real) apify-webhook-secret reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=c8ff23f3540867df atom=pk_atom_CELL_1_01
[cell-1] atom 1 source OK id=pk_atom_CELL_1_01 call_id=c8ff23f3540867df
[cell-1] after-atom-1 (real) apify-token reads=1 current_version=v1
[cell-1] after-atom-1 (real) apify-actor-id reads=1 current_version=v1
[cell-1] after-atom-1 (real) apify-webhook-secret reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=8ec7f28fc0b87f32 atom=pk_atom_CELL_1_02
[cell-1] atom 2 source OK id=pk_atom_CELL_1_02 call_id=8ec7f28fc0b87f32
[cell-1] after-atom-2 (real) apify-token reads=1 current_version=v1
[cell-1] after-atom-2 (real) apify-actor-id reads=1 current_version=v1
[cell-1] after-atom-2 (real) apify-webhook-secret reads=1 current_version=v1
[cell-1] final (real) apify-token reads=1 current_version=v1
[cell-1] final (real) apify-actor-id reads=1 current_version=v1
[cell-1] final (real) apify-webhook-secret reads=1 current_version=v1
```

### 2.2 Cell (3) — scoped sub-resolver in deps

Cell (3) trace is structurally identical to § 2.1: every `[cell-3]`
line matches the corresponding `[cell-1]` line on `reads=` and
`current_version=` columns; `[apify-http] client built` line is
byte-identical (same bearer / actor / whsec tail); only atom IDs
(`pk_atom_CELL_3_01/02`) and the resulting HMAC `call_id` digests
(`7b3c0cdc90512b33`, `3246f603bb930aff`) differ. § 2.3 ledger captures
the comparison axis in full.

### 2.3 Read-count + token_seen ledger (cells 1 vs 3)

| Step / name                    | cell (1) flat reads / version | cell (3) scope reads / version |
| ------------------------------ | ----------------------------- | ------------------------------ |
| initial — apify-token          | 0 / v1                        | 0 / v1                         |
| initial — apify-actor-id       | 0 / v1                        | 0 / v1                         |
| initial — apify-webhook-secret | 0 / v1                        | 0 / v1                         |
| post-factory — apify-token     | 1 / v1                        | 1 / v1                         |
| post-factory — apify-actor-id  | 1 / v1                        | 1 / v1                         |
| post-factory — apify-whsec     | 1 / v1                        | 1 / v1                         |
| after-atom-1 — apify-token     | 1 / v1                        | 1 / v1                         |
| after-atom-1 — apify-actor-id  | 1 / v1                        | 1 / v1                         |
| after-atom-1 — apify-whsec     | 1 / v1                        | 1 / v1                         |
| after-atom-2 — apify-token     | 1 / v1                        | 1 / v1                         |
| after-atom-2 — apify-actor-id  | 1 / v1                        | 1 / v1                         |
| after-atom-2 — apify-whsec     | 1 / v1                        | 1 / v1                         |
| final — apify-token            | 1 / v1                        | 1 / v1                         |
| final — apify-actor-id         | 1 / v1                        | 1 / v1                         |
| final — apify-whsec            | 1 / v1                        | 1 / v1                         |
| `bearer=` in apify-http POST   | `apify-tok-v1`                | `apify-tok-v1`                 |
| `actor=` in apify-http POST    | `apify/web-scraper`           | `apify/web-scraper`            |
| `webhook_secret_tail=` at build| `c-v1`                        | `c-v1`                         |

The diagnostics that matter:

- **Read-count ledger byte-identical across cells (1) and (3)** for all
  3 names at every observation point. Per-name reads=1 across the
  entire run (3 factory reads + 1 signer-per-atom for `apify-token`
  against the parent cache), independent of deps shape. The composite
  -name forwarding (sub-view → parent wrapper with `${prefix}-${suffix}`)
  lands on the same cache entries cell (1)'s flat resolves do — by
  construction. Multi-secret at N=3 does not change this.
- **Closed-over secrets observably identical**: bearer / actor / whsec
  tail strings match across cells. `call_id` HMAC digests differ only
  because atom IDs differ (naming noise, not behavioural divergence).

## 3. WHAT THE EVIDENCE SHOWS

### 3.1 Cell (1) — flat / single resolver

- **Read collapse?** *Yes.* `apify-token` reads=1 across 1 factory call
  + 2 signer calls; `apify-actor-id` reads=1; `apify-webhook-secret`
  reads=1. Wrapper collapses per-call resolves to one underlying read
  per name per version, extending spike #5's N=2 finding to N=3.
- **Discoverability?** *String-only.* 3 string literals at factory
  + 1 in signer. Deps type (`{ secrets: SecretsResolver }`) does NOT
  pin the namespace; users grep for the `'apify-` prefix.
- **Composition tax?** *Zero — 3 lines `secrets.resolve('apify-X')`
  in factory + 1 in signer.* No façade construction.
- **Author-question count?** *1 — "which name?" (per resolve site).*

### 3.2 Cell (3) — scoped sub-resolver

- **Read collapse?** *Yes — observably identical to cell (1).* Same
  ledger; same closed-over strings. Composite-name forwarding lands on
  the same parent cache entries; runtime behaviour byte-identical by
  construction. N=3 expansion does not break the collapse.
- **Discoverability?** *Type-pinned at the deps boundary; string-level
  at the suffixes.* Deps type
  (`{ apifySecrets: ScopedSecretsResolver }`) names the namespace at
  the adapter signature; the driver's `wrapped.scope('apify')` line
  is a single bind point. Three suffixes (`'token'`, `'actor-id'`,
  `'webhook-secret'`) remain string literals — type does not
  constrain. Net: namespace at type level (gain vs cell (1)); suffix
  at string level (parity).
- **Composition tax?** *1 import + 1 scope-bind line at driver + 3
  `apifySecrets.resolve('X')` in factory + 1 in signer.* Scope-bind
  sits at DI boundary; factory body shorter (suffixes vs full names);
  closure caches the sub-view via deps.
- **Author-question count?** *2 — "where to bind the scope?" + "which
  suffix?".*

### 3.3 Cross-cell verdict

- **Runtime collapse total.** Every observable matches byte-for-byte
  across cells; Q4 deps-shape axis cannot be decided on runtime
  grounds at N=3.
- **Type-level discoverability gain at N=3 is real but bounded.**
  Cell (3) pins the namespace at the adapter signature AND
  deduplicates the `apify-` prefix from 3 literals to 1 scope-bind.
  Suffix strings stay strings; gain is "1 type pin + N prefix
  dedups" — meaningful at N=3, not transformative.
- **Composition tax delta is small but nonzero.** +1 import + 1
  scope-bind for cell (3); zero for cell (1); paid once per adapter
  regardless of N.
- **Adapter author ergonomics at N=3.** Cell (3)'s
  `apifySecrets.resolve('actor-id')` reads more naturally than
  cell (1)'s `secrets.resolve('apify-actor-id')`, but the difference
  is cosmetic, not structural.

## 4. DOES STRUCTURAL SCOPE EARN ITS KEEP UNDER N=3?

**Headline (Q4 deps-shape verdict at this leg's resolution): MARGINAL —
structural scope pays a small composition tax in exchange for a real
but bounded discoverability gain at the deps signature. The kit's
default deps shape SHOULD remain flat
(`{ secrets: SecretsResolver }`), with `scope()` available as an
optional façade for adapter authors who prefer the type-pinned
namespace at N>=3.**

Three observations driving this:

1. **Runtime observables collapse by construction at N=3.** Cells (1)
   and (3) produce byte-identical read-count + closed-over-value
   ledgers across 3 secrets, 4 read sites, 2 atoms — same as spike #5
   at N=2. The composite-name forwarding eliminates any runtime
   distinction between flat and scoped deps shapes. Q4 deps-shape
   cannot be decided on runtime grounds at this N.

2. **Discoverability gain at the deps signature is real but bounded.**
   Cell (3)'s deps type
   (`{ apifySecrets: ScopedSecretsResolver }`) pins the namespace at
   the adapter signature; cell (1)'s deps type
   (`{ secrets: SecretsResolver }`) does not. At N=3, the scope-bind
   also deduplicates the `apify-` prefix three times to once. But the
   suffix strings (`'token'`, `'actor-id'`, `'webhook-secret'`) remain
   string literals on both sides; the type does not constrain them.
   Net gain: 1 type pin + 1 prefix-dedup site. Worth something at
   N=3; not transformative.

3. **Composition tax remains small but nonzero, and amortises over
   N.** Cell (3) costs +1 import + 1 scope-bind line + 1 author
   question. Tax is paid once per adapter regardless of N. At N=1
   (spike #5 cell (f)) the tax was harder to justify; at N=3
   (this leg) it amortises better — three short suffix resolves vs
   three long flat-name resolves is a wash on density terms but is a
   readability win at the resolve site.

**What Q4 ADR can defensibly say at synthesis with leg-3 evidence
(multi-axis: runtime + discoverability + deps-shape):**

> "Under `B + version-aware-resolver`, the kit's default deps shape
> SHOULD be `{ secrets: SecretsResolver }` (flat single resolver,
> multi-resolve). Adapters consuming N>=3 secrets from one namespace
> MAY accept `{ <ns>Secrets: ScopedSecretsResolver }` instead, with
> the driver constructing the scope at the DI boundary
> (`wrapped.scope('<ns>')`); this trades +1 import + 1 scope-bind for
> a type-pinned namespace at the adapter signature and prefix
> deduplication at the resolve sites. Both shapes produce byte-
> identical runtime observables under the version-aware-resolver's
> composite-name + shared-cache design — empirically validated at
> N=3. Brain SHOULD NOT promote `scope()` to a kit-default shape; it
> SHOULD remain an optional façade documented as the natural choice
> for namespace-heavy adapters."

## 5. CELL (2) — STRUCTURAL DISQUALIFICATION (FLAG-ONLY)

Cell (2) (dep-per-secret pre-resolved at construction —
`{ apifyToken: string; apifyActorId: string; apifyWebhookSecret: string }`)
was NOT built. The disqualification is structural, not empirical.
Empirical re-derivation would burn LOC for a pre-determined verdict.

**Anchor refs.**

- **`research/spikes/identity-secrets/rotation-mid-run/FINDINGS-spike-2.md`
  § 8 (and supporting § 5 lines 165–178)** — variant B's default leak
  surface is "stale value forever, until the adapter (or wrapper) is
  reconstructed. Cross-run leak is the *zero effort* path. Avoiding it
  requires the user to know they should rebuild the adapter per run,
  which contradicts the natural 'construct once at boot, reuse across
  runs' server pattern." Cell (2) is the canonical instance of this
  posture: if the deps-builder pre-resolves all 3 secrets at boot, the
  values are frozen in the closure; rotation goes unobserved
  indefinitely. § 8 carries forward the explicit demand for spikes #3
  and #4 to address this — the version-aware wrapper resolves it
  *only when consulted per-resolve*. Pre-resolved values cannot
  participate in the wrapper's stats-probe-and-revalidate machinery
  because by definition they have already been read.

- **`research/spikes/identity-secrets/naming-vs-scope/FINDINGS-spike-5.md`
  § 3.3 (and § 7 carry-forward #2)** — "the wrapper instance owns ALL
  cached secrets across all scopes (no per-scope cache forking by
  design). [...] cache lives on the resolver wrapper instance; scopes
  are name-composition façades that share the parent cache." Cell (2)
  cannot participate in that mechanism *at all* — its values do not
  pass through the wrapper at the read site, only at construction. The
  cache absorbs nothing on cell (2)'s behalf because cell (2) consults
  the cache exactly zero times after factory construction.

- **Carry-forward #8 from leg-1 (and spike #2 § 8 / spike #3 § 7)** —
  adapter reconstruction is a Composer-level concern; pre-resolving at
  construction makes the deps-builder either a per-run Composer
  concern OR a cross-run leak. The kit's deps-builder has no Composer
  authority: it sits below Composer, with one boot-time invocation by
  default. To make cell (2) rotation-safe, the kit would have to
  promote the deps-builder to a per-run callable — which is precisely
  what `B + version-aware-resolver` already does at the resolver
  level, more cheaply.

**Verdict.** Cell (2)'s rotation-safety posture is structurally
dominated by spike #2's findings. The two prongs are:

- **Boot-time deps-builder** (cell (2)'s natural shape): all 3 secrets
  resolved once, frozen in the closure for the adapter's lifetime.
  Cross-run rotation leak is the zero-effort default path. Spike #2's
  empirical reversal applies in full.
- **Per-run deps-builder**: pre-resolves all 3 secrets per run. This
  is no longer "dep-per-secret" in any meaningful sense — it's a
  per-run rebuild of the deps closure, which is a Composer concern
  (carry-forward #8) and still does not collapse reads across the
  signer's run-time site (the deps-builder cannot know when the
  signer fires).

Either prong is structurally disqualifying for the kit-default deps
shape. Cell (2) cannot generalise. Skipping the empirical run is
disciplined — it is not a gap.

## 6. PER-CELL SCORECARD

| Dimension                                   | cell (1) flat                           | cell (3) scope                                        |
| ------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| read collapse — apify-token (per name)      | reads=1 per version                     | reads=1 per version (identical)                       |
| read collapse — apify-actor-id (per name)   | reads=1 per version                     | reads=1 per version (identical)                       |
| read collapse — apify-webhook-secret        | reads=1 per version                     | reads=1 per version (identical)                       |
| tokens / actor / whsec observed             | tok-v1 / web-scraper / whsec-v1         | tok-v1 / web-scraper / whsec-v1 (identical)           |
| call sites per factory (count)              | 4 (3 factory resolves + 1 signer)       | 5 (1 scope-bind + 3 factory resolves + 1 signer)      |
| type-level namespace pin (deps signature)   | none (string-only)                      | yes (`ScopedSecretsResolver` at deps)                 |
| suffix discoverability                      | n/a (flat full names)                   | string-level only                                     |
| composition tax (per adapter)               | 0                                       | 1 import + 1 scope-bind line                          |
| import count delta vs cell (1)              | baseline                                | +1 (`ScopedSecretsResolver`)                          |
| author-question count                       | 1 ("which name?")                       | 2 ("where to bind scope?", "which suffix?")           |
| rotation-safety posture                     | per-resolve consultation; safe (wrapper)| per-resolve consultation; safe (wrapper)              |

The composition-tax + author-question columns are where cells diverge.
Every behavioural column collapses. The new columns (vs spike #5):
import-count delta and per-name read collapse at N=3 are now
empirically established at byte-identical parity.

## 7. Q4 ADR NARROWING ASSESSMENT (post-leg-3)

**What firms up at synthesis (deps-shape axis defensible direction):**

- **Default deps shape is flat** (`{ secrets: SecretsResolver }`).
  Every adapter that takes this shape can call `secrets.resolve(name)`
  with full hyphenated names; the version-aware-resolver collapses
  repeated reads and validates against rotation per call.
- **Scoped deps shape is OPTIONAL** for namespace-heavy adapters
  (N>=3-from-one-namespace). The driver constructs the sub-view at the
  DI boundary; the adapter takes
  `{ <ns>Secrets: ScopedSecretsResolver }`. Both shapes produce
  byte-identical runtime observables — empirically validated at
  N=3 in this leg.
- **Cell (2) (dep-per-secret pre-resolved) is structurally
  disqualified** as a kit-default shape — see § 5.

The deps-shape sentence brain can now defensibly write at synthesis:

> "When an adapter consumes N>=3 secrets from one namespace under
> `B + version-aware-resolver`, the kit's default deps shape SHOULD
> remain flat (`{ secrets: SecretsResolver }`). Structural scope
> (`{ <ns>Secrets: ScopedSecretsResolver }`) provides a meaningful
> type-level namespace pin at the adapter signature plus N-fold
> prefix deduplication at the resolve sites, at a cost of 1 extra
> import + 1 scope-bind line at the DI boundary. The tax amortises
> better at higher N but does not invert the default. Adapter authors
> MAY adopt the scoped shape; the kit MUST NOT mandate it. Cell (2)
> (dep-per-secret pre-resolved at construction) is structurally
> disqualified — its rotation-safety posture is dominated by spike #2
> § 5/§ 8 (boot-time leak) and spike #5 § 3.3 (cache shared by
> construction)."

**What stays open:**

- Carry-forward #11 (TTL / push-rotation composition with `scope()`)
  — UNCHANGED. This leg does not exercise alternative wrapper layers.
- Carry-forward #12 (joiner choice — hyphen vs dotted) — UNCHANGED at
  N=3. The hyphen joiner stays unexercised by edge cases.
- HMAC envelope generalisation (Q5 territory) — `mintWebhookDigest`
  exported but never invoked by either cell; remains a separate
  question for synthesis or future spike.

## 8. CARRY-FORWARD UPDATES

Re-listing leg-2 § 7 carry-forwards (#1–#12) with status updates from
this leg's evidence.

1. **Rotation semantics.** **UNCHANGED.** No `invalidate()` calls in
   leg-3. Single-version run.
2. **Cache scope as ADR.** **REFINED — confirmed at N=3.** The parent
   cache absorbs all 3 resolves under both deps shapes, including the
   per-request signer's repeat call on `apify-token`. Brain's leg-2
   phrasing ("cache lives on the wrapper instance; scopes are
   name-composition façades that share the parent cache") survives
   N=3 unchanged.
3. **SOPS / file-backed resolver ergonomics.** **UNCHANGED.** Mock-only.
4. **Multi-secret pipelines + scoping.** **RESOLVED (deps-shape axis).**
   Leg-2 resolved the runtime + discoverability axes at N=2; this leg
   resolves the deps-shape axis at N=3. All three Q4 sub-axes now have
   evidence: runtime collapse total, discoverability gain bounded but
   real, deps-shape default flat with scope as optional façade. Brain
   can synthesise Q4 in full.
5. **Construction-time secrets.** **REFINED.** `apify-actor-id` and
   `apify-webhook-secret` are factory-time-only reads in this leg —
   classic construction-time secrets. The version-aware wrapper
   handles them indistinguishably from the two-site `apify-token`.
   Spike #3's verdict stands.
6. **Stage-typed Secrets vs ambient ctx vs deps.** **UNCHANGED.**
7. **Version-aware resolver default.** **UNCHANGED — RESOLVED-ADOPT.**
8. **Adapter reconstruction as a Composer concern.** **REFINED.**
   Cell (2)'s § 5 disqualification confirms this carry-forward in the
   negative direction: pre-resolved deps cannot be made
   rotation-safe without elevating the deps-builder to a per-run
   Composer concern. Narrow scope (non-re-readable resources only)
   stands; this leg's secrets are all re-readable.
9. **Async factory ergonomics.** **UNCHANGED.** Both factories in this
   leg are async (3 factory awaits each); same pattern as legs-1/2.
10. **Two-site contract in adapter docs.** **UNCHANGED.** `apify-token`
    remains the only two-site secret; the other two are factory-only.
    Adapter docs should distinguish.
11. **Wrapper composition with TTL / push-rotation layers.**
    **UNCHANGED.** Not exercised in leg-3.
12. **Composite-name joiner choice.** **UNCHANGED at N=3.** Hyphen
    joiner survives 3-secret expansion without edge-case stress.

**No new carry-forward.** Leg-3 surfaces no question that was not
already on the carry-forward list. The HMAC envelope generalisation
(`mintWebhookDigest`) was already flagged as Q5 territory in leg-2 §
7 #11; presence-in-scope at the read-site is the only new artefact.

## 9. WHAT SYNTHESIS NEEDS NEXT

**Now answerable at synthesis (no further spike):**

- Q4 deps-shape ADR direction — see § 7. Default flat;
  `scope()` as optional façade; cell (2) structurally disqualified.
- Carry-forward #2 (cache scope) phrasing — confirmed at N=3.
- Carry-forward #4 (multi-secret + scoping) — fully resolved across
  runtime / discoverability / deps-shape axes.
- Carry-forward #5 (construction-time secrets) — empirically
  exercised at N=3 alongside two-site; no fresh question.

**Possibly defer to leg-4 (default expectation: NO leg-4 needed):**

- Leg-3 surfaced no unanticipated question. Brain's locked Phase 1
  spike order does not call for leg-4 of Cat VIII; synthesis is the
  natural next step. If a leg-4 is ever triggered, it would have to
  be by a fresh question (e.g. cross-namespace mixed-cardinality, or
  per-scope cache forking under TTL).

**Out of leg-3 scope but possibly synthesis-time:**

- Q5 HMAC envelope generalisation — separate question; leg-3 only
  installed the `mintWebhookDigest` helper as a no-op import-site.
- Carry-forward #8 narrow-scope (non-re-readable resource adapter
  reconstruction) — Composer-level concern, not a Cat VIII spike.
- Carry-forward #11 TTL / push-rotation layer composition with
  `scope()` — could be answered at synthesis if brain locks "pull-only
  via stats" as the kit's default rotation-detection mechanism;
  otherwise a future Cat VIII leg.

## 10. HONEST SCOPE BOUND

This leg did NOT probe:

- **Cell (2) — flag-only.** Structurally disqualified; see § 5.
- **Sub-question (3) — variant C re-entry.** Spike #3 / spike #5
  said NOT triggered; this leg does not re-trigger.
- **Cross-namespace mixed-cardinality.** apify×3 only; no supabase
  mixed in. Whether `{ apifySecrets, supabaseSecrets }` shape is a
  natural extension is plausible but unprobed.
- **HMAC envelope generalisation.** `mintWebhookDigest` exported but
  never invoked by either cell. Q5 territory.
- **Per-scope cache forking.** Sub-view shares parent cache by
  design (locked in leg-2).
- **Dotted-name regex extension.** Hyphen-only joiner; kit
  `NAME_RE` unchanged.
- **Multi-secret rotation interplay.** No `invalidate(name)` calls in
  leg-3. Whether rotating one of three secrets mid-run interacts
  weirdly with shared caches is untested.
- **Recursive scopes.** Wrapper supports `scope().scope()`; no
  harness drives it.
- **Async scope construction.** `scope()` is sync; whether async
  scope construction is ever needed is untested.
- **Real backends.** Mock-only.
- **Concurrent `resolve()` calls.** Single-threaded JS event loop,
  single-atom-at-a-time harness; no thundering-herd / stampede
  protection probed.
- **Webhook-Serve fixture.** Source-only at N=3; no Serve stage; no
  outbound-webhook signing exercised.

What this leg DID empirically establish: under
`B + version-aware-resolver` extended with the leg-2 sub-view-sharing
`scope(prefix)` façade, a Source(apify) factory consuming 3 secrets in
the apify namespace produces byte-identical read-count + closed-over-
value ledgers under the flat deps shape (single resolver,
multi-resolve) and the scoped deps shape (sub-view in deps). Q4
deps-shape ADR can defensibly default to flat
(`{ secrets: SecretsResolver }`) and treat structural scope as an
optional façade adapter authors MAY adopt at N>=3-from-one-namespace.

# Cat VIII Spike #4 leg-1 — `version-aware-resolver` Findings

> Spike: a `createVersionAwareResolver(real)` wrapper run against B.1
> (close-over) and B.2 (re-resolve) adapter shapes under both the spike-#3
> two-site harness AND the spike-#2 rotation harness — four observable
> cells in a 2×2 matrix.
> Branch: `v1-cat-VIII-spike-4-version-aware-resolver`. Author: Executor
> — 2026-05-09. Forked from spike #3 (master tip 152a32d).
> Companion to: `docs/research-outline-v1.md` § Category VIII (Identity /
> Secrets).
> Status: spike output (NOT a notes file; brain synthesises a
> notes-v1-cat-VIII.md later).
> Friction anchor: `F-AUTH` — top-15 #2, 9/9 universality.
> Leg-2 (multi-secret) is OUT OF SCOPE for this spike.

## 1. WHAT WAS BUILT

A pull-only caching wrapper, plus four cells over fixtures forked
verbatim from spike #2 / spike #3:

- **`version-aware-resolver.ts` (65 LOC).** `createVersionAwareResolver(real)`
  returns a `SecretsResolver`-shaped object. On `resolve(name)`: probe
  `real.stats(name).current_version`; if cache has `{value, version}`
  for `name` matching current version → return cached; else
  `await real.resolve(name)`, forward Err unchanged (no caching),
  stamp Ok into cache. `invalidate(name)` and `stats(name)` are
  pass-through; wrapper does NOT proactively drop cache on
  `invalidate` — the version-stamp probe on the next `resolve(name)`
  is the cache-drop mechanism (the design point: is version-stamp-only
  sufficient?).
- **Cell (a) — B.1 close-over + VA, two-site harness.** Factory
  resolves once via wrapper; bearer + signer close over factory-time
  string. Mirrors spike-#3 B.1 with `wrapped` substituted at `deps.secrets`.
- **Cell (b) — B.2 re-resolve + VA, two-site harness.** Factory
  resolves for HTTP-client construction; signer closure re-resolves
  per call via `deps.secrets` (now the wrapper). Mirrors spike-#3 B.2.
- **Cell (c) — B.1 close-over + VA, rotation harness.** Adapter calls
  `secrets.resolve('apify-token')` per iter (no adapter cache); run #1
  atom 1 cold → atom 2 warm → invalidate underlying real → atom 3
  post-rotation → run #2 atom 1 fresh ctx, SAME adapter. Mirrors
  spike-#2 B-CoA reused-adapter shape.
- **Cell (d) — B.2 re-resolve + VA, rotation harness.** Same harness
  shape as cell (c); under the wrapper the B.1 vs B.2 distinction
  collapses to the same call site. Traces match cell (c) by
  construction — see §3 / §4.

Shared fixtures: `mock-secrets-resolver.ts` and
`mock-apify-http-client.ts` are bit-identical forks of spike #3; read
counts are directly comparable to spike #2 / #3. Two atoms per
two-site cell; rotation cells run 3 atoms in run #1 (with mid-run
invalidate) plus 1 atom in run #2.

## 2. THE FOUR CELL TRACES

Verbatim run output (from `bash run-spike-4.sh`):

### 2.1 Cell (a) — B.1 close-over + VA, two-site harness

```
==> [1/2] Variant B.1 — close-over + version-aware wrapper (cells (a) + (c))
### CELL (a) — B.1 close-over + version-aware wrapper, two-site harness ###
[variant-b1-va] initial (real) reads=0 current_version=v1
[variant-b1-va] post-factory (real) reads=1 current_version=v1
[variant-b1-va] pre-request pk_atom_VARIANT_B1_VA_01 bearer_token_resolved_count(*)=1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=74c1e5b4cca35cdb atom=pk_atom_VARIANT_B1_VA_01
[variant-b1-va] post-request pk_atom_VARIANT_B1_VA_01 signer_resolved_count(*)=1
[variant-b1-va] cell-a OK atom pk_atom_VARIANT_B1_VA_01 call_id=74c1e5b4cca35cdb
[variant-b1-va] pre-request pk_atom_VARIANT_B1_VA_02 bearer_token_resolved_count(*)=1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=3b6a834d4c3b9542 atom=pk_atom_VARIANT_B1_VA_02
[variant-b1-va] post-request pk_atom_VARIANT_B1_VA_02 signer_resolved_count(*)=1
[variant-b1-va] cell-a OK atom pk_atom_VARIANT_B1_VA_02 call_id=3b6a834d4c3b9542
[variant-b1-va] final (real) reads=1 current_version=v1
```

### 2.2 Cell (b) — B.2 re-resolve + VA, two-site harness

```
==> [2/2] Variant B.2 — re-resolve + version-aware wrapper (cells (b) + (d))
### CELL (b) — B.2 re-resolve + version-aware wrapper, two-site harness ###
[variant-b2-va] initial (real) reads=0 current_version=v1
[variant-b2-va] post-factory (real) reads=1 current_version=v1
[variant-b2-va] pre-request pk_atom_VARIANT_B2_VA_01 bearer_token_resolved_count(*)=1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=56ae56dfd78a8793 atom=pk_atom_VARIANT_B2_VA_01
[variant-b2-va] post-request pk_atom_VARIANT_B2_VA_01 signer_resolved_count(*)=1
[variant-b2-va] cell-b OK atom pk_atom_VARIANT_B2_VA_01 call_id=56ae56dfd78a8793
[variant-b2-va] pre-request pk_atom_VARIANT_B2_VA_02 bearer_token_resolved_count(*)=1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=026190d388da2f53 atom=pk_atom_VARIANT_B2_VA_02
[variant-b2-va] post-request pk_atom_VARIANT_B2_VA_02 signer_resolved_count(*)=1
[variant-b2-va] cell-b OK atom pk_atom_VARIANT_B2_VA_02 call_id=026190d388da2f53
[variant-b2-va] final (real) reads=1 current_version=v1
```

### 2.3 Cell (c) — B.1 close-over + VA, rotation harness

```
### CELL (c) — B.1 close-over + version-aware wrapper, rotation harness ###
--- B1-VA rotation: RUN #1 atom 1 (cold cache) ---
[variant-b1-va] run1.atom1 OK atom pk_atom_VARIANT_B1_VA_run_1 token_seen="apify-tok-v1"
[variant-b1-va] run1.atom1 (real) reads=1 current_version=v1
--- B1-VA rotation: RUN #1 atom 2 (warm cache, no rotation) ---
[variant-b1-va] run1.atom2 OK atom pk_atom_VARIANT_B1_VA_run_1 token_seen="apify-tok-v1"
[variant-b1-va] run1.atom2 (real) reads=1 current_version=v1
--- B1-VA rotation: invalidating apify-token on REAL resolver ---
[variant-b1-va] post-invalidate (real) reads=1 current_version=v2
--- B1-VA rotation: RUN #1 atom 3 (post-rotation, same adapter+ctx) ---
[variant-b1-va] run1.atom3 OK atom pk_atom_VARIANT_B1_VA_run_1 token_seen="apify-tok-v1-rotated-v2"
[variant-b1-va] run1.atom3 (real) reads=2 current_version=v2
--- B1-VA rotation: RUN #2 atom 1 (fresh ctx, REUSED adapter) ---
[variant-b1-va] run2.atom1 OK atom pk_atom_VARIANT_B1_VA_run_2 token_seen="apify-tok-v1-rotated-v2"
[variant-b1-va] run2.atom1 (real) reads=2 current_version=v2
```

### 2.4 Cell (d) — B.2 re-resolve + VA, rotation harness

```
### CELL (d) — B.2 re-resolve + version-aware wrapper, rotation harness ###
--- B2-VA rotation: RUN #1 atom 1 (cold cache) ---
[variant-b2-va] run1.atom1 OK atom pk_atom_VARIANT_B2_VA_run_1 token_seen="apify-tok-v1"
[variant-b2-va] run1.atom1 (real) reads=1 current_version=v1
--- B2-VA rotation: RUN #1 atom 2 (warm cache) ---
[variant-b2-va] run1.atom2 OK atom pk_atom_VARIANT_B2_VA_run_1 token_seen="apify-tok-v1"
[variant-b2-va] run1.atom2 (real) reads=1 current_version=v1
--- B2-VA rotation: invalidating apify-token on UNDERLYING real resolver ---
[variant-b2-va] post-invalidate (real) reads=1 current_version=v2
--- B2-VA rotation: RUN #1 atom 3 (post-rotation) ---
[variant-b2-va] run1.atom3 OK atom pk_atom_VARIANT_B2_VA_run_1 token_seen="apify-tok-v1-rotated-v2"
[variant-b2-va] run1.atom3 (real) reads=2 current_version=v2
--- B2-VA rotation: RUN #2 atom 1 (fresh ctx, REUSED adapter) ---
[variant-b2-va] run2.atom1 OK atom pk_atom_VARIANT_B2_VA_run_2 token_seen="apify-tok-v1-rotated-v2"
[variant-b2-va] run2.atom1 (real) reads=2 current_version=v2
```

### 2.5 Read-count + token_seen ledger

Two-site cells (factory + 2 atoms):

| Cell                     | post-factory reads | reads after atom 1 | final reads (after atom 2) |
| ------------------------ | ------------------ | ------------------ | -------------------------- |
| spike-#3 B.1 (no wrap)   | 1                  | 1                  | 1                          |
| spike-#3 B.2 (no wrap)   | 1                  | 2                  | 3                          |
| **cell (a) B.1 + VA**    | **1**              | **1**              | **1**                      |
| **cell (b) B.2 + VA**    | **1**              | **1**              | **1**                      |

Rotation cells (full sequence):

| Step                             | spike-#2 B-CoA (no wrap) | spike-#2 B-CoR (no wrap) | **cell (c) B.1+VA**  | **cell (d) B.2+VA**  |
| -------------------------------- | ------------------------ | ------------------------ | -------------------- | -------------------- |
| run1.atom1 reads / token_seen    | 1 / `apify-tok-v1`       | 1 / `apify-tok-v1`       | **1 / `apify-tok-v1`** | **1 / `apify-tok-v1`** |
| run1.atom2 reads / token_seen    | 1 / `apify-tok-v1`       | 1 / `apify-tok-v1`       | **1 / `apify-tok-v1`** | **1 / `apify-tok-v1`** |
| post-invalidate version          | v2                       | v2                       | **v2**               | **v2**               |
| run1.atom3 reads / token_seen    | 1 / `apify-tok-v1` (STALE) | 1 / `apify-tok-v1` (STALE) | **2 / `apify-tok-v1-rotated-v2` (FRESH)** | **2 / `apify-tok-v1-rotated-v2` (FRESH)** |
| run2.atom1 reads / token_seen    | 1 / `apify-tok-v1` (LEAK)  | 1 / `apify-tok-v1` (LEAK)  | **2 / `apify-tok-v1-rotated-v2` (FRESH)** | **2 / `apify-tok-v1-rotated-v2` (FRESH)** |

The two diagnostics that matter:
- **Two-site final reads.** Spike-#3 had B.1=1, B.2=3. Under the wrapper,
  both collapse to **1**. This is the headline read-count finding.
- **Cross-run rotation leak.** Spike-#2 B-CoA and B-CoR both leaked the
  pre-rotation token across run boundaries (`run2.atom1` saw
  `apify-tok-v1` despite version=v2). Under the wrapper, both cells
  serve the rotated value (`apify-tok-v1-rotated-v2`). The leak closes
  in both cells.

## 3. WHAT THE EVIDENCE SHOWS

Per cell, the two questions:

### 3.1 Cell (a) — B.1 close-over + VA, two-site harness

- **(a) Leak close / read collapse?** *No leak existed in B.1 to
  close* (spike-#3 B.1 was already at reads=1); the wrapper preserves
  that property. Pure pass-through — sanity check that the wrapper
  does not inflate reads on already-optimal shapes.
- **(b) Type-level visibility vs spike #3?** *No change.* The wrapper
  is a `SecretsResolver` — same interface, same Result envelope. The
  wrapper is structurally invisible at the call site, which is the
  point of treating it as a default kit primitive.

### 3.2 Cell (b) — B.2 re-resolve + VA, two-site harness

- **(a) Leak close / read collapse?** ***Yes — headline collapse.***
  Spike-#3 B.2 was post-factory=1, after atom 1=2, after atom 2=3.
  Under the wrapper, cell (b) is post-factory=1, after atom 1=1, after
  atom 2=1. Per-atom signer re-resolves are absorbed by the wrapper's
  cache (version unchanged across the run). Read-count axis collapses
  entirely between B.1 and B.2 for the steady-state two-site case.
- **(b) Type-level visibility?** *No change vs spike #3.* Signer
  closure still calls `await secrets.resolve('apify-token')` per call;
  TS sees the same shape. Runtime behaviour changes invisibly.

### 3.3 Cell (c) — B.1 close-over + VA, rotation harness

- **(a) Leak close / read collapse?** ***Yes — both leaks close.***
  Spike-#2 B-CoA leaked `apify-tok-v1` across run boundaries despite
  underlying version=v2. Under the wrapper, `run1.atom3` serves
  `apify-tok-v1-rotated-v2` after the version bump, AND `run2.atom1`
  continues to see the rotated value. Version-stamp cache-drop fires
  at the natural time: the first resolve after the bump misses
  (cache.version=v1 !== current=v2), re-fetches, re-stamps. No
  proactive cache-invalidation needed. Read sequence: 1 (cold) → 1
  (warm hit) → 2 (post-rotation miss + re-fetch) → 2 (cross-run hit
  on v2). The +1 at rotation is the version-bump cost, amortised over
  all subsequent reads of the new version.
- **(b) Type-level visibility?** *No change.* Per 3.1 / 3.2.

  **HONESTY NOTE.** The B.1 "close-over" semantics from spike-#3
  cannot be tested in the rotation harness as-is — the rotation
  harness has no separate factory site that closes over a token. My
  cell (c) calls `secrets.resolve` per iter, i.e. the adapter
  delegates caching to the wrapper. This IS the natural shape for B +
  version-aware-by-default: B.1's ergonomic argument (factory once,
  signer captures) loses its motive when `secrets.resolve` is cheap.

### 3.4 Cell (d) — B.2 re-resolve + VA, rotation harness

- **(a) Leak close / read collapse?** ***Yes — observably identical
  to cell (c).*** Spike-#2 B-CoR leaked like B-CoA. Under the wrapper,
  cell (d) shows the same step ledger as (c): cold=1, warm=1,
  post-rotation=2, cross-run=2. Token-seen sequence identical. The
  wrapper closes the leak in both adapter shapes because adapter
  shape stops mattering once the wrapper owns caching.
- **(b) Type-level visibility?** *No change.* Per 3.1 / 3.2.

## 4. DOES VERSION-AWARE-BY-DEFAULT COLLAPSE B.1 vs B.2?

**Headline answer: full collapse on the observables this spike measured.**

Observables (read counts, token_seen values, cross-run leak status,
rotation-fresh status) are byte-identical between cell (a) and cell
(b) on the two-site harness, and between cell (c) and cell (d) on the
rotation harness. The wrapper absorbs the B.1 vs B.2 sub-cell
distinction at the runtime-behaviour level.

Concretely:

1. **Two-site reads collapse to 1.** Cells (a) and (b) both end at
   `final reads=1`. Spike-#3's B.2 `reads=3` is gone — the per-atom
   signer re-resolve short-circuits to cache.
2. **Rotation cross-run leak closes in both cells.** Cells (c) and
   (d) both serve the rotated token in `run2.atom1`; the spike-#2 §6
   leak is closed structurally by the wrapper, not by adapter shape.
3. **The B.1 ergonomic motive disappears.** Under the wrapper, B.1's
   "single resolve for cleanliness" is preserved at runtime
   (cell (a) reads=1) without the adapter doing anything special.
   B.2's "call resolve every site" becomes idiomatic because it costs
   nothing.

**Honest qualifier.** This is full collapse on the dimensions
measured. Two unprobed dimensions could still split B.1 vs B.2:
- **Long-lived non-re-readable resources** (HTTP/2 connection built
  at handshake time; pre-signed URL). Wrapper makes `resolve()`
  rotation-aware but cannot rebuild a stateful resource whose lifetime
  exceeds the secret's validity. B.1's close-over is susceptible;
  B.2's re-resolve is not. Carry-forward #8 — see §6 / §7.
- **Synchronous API surfaces.** Wrapper's `resolve()` is async. Out
  of scope.

So: **full collapse on read-count and rotation-leak axes; partial
collapse on the broader "can the adapter survive rotation" question
because non-re-readable resources still need adapter reconstruction.**

## 5. PER-CELL SCORECARD

| Cell                     | duplication            | type visibility            | reads (key step)            | rotation default          | cross-run leak status |
| ------------------------ | ---------------------- | -------------------------- | --------------------------- | ------------------------- | --------------------- |
| spike-#3 B.1 (no wrap)   | no (single capture)    | partial (factory visible)  | 1 (2 atoms)                 | stale (no re-read)        | leaks                 |
| spike-#3 B.2 (no wrap)   | yes, explicit          | partial (factory visible)  | 3 (2 atoms)                 | partly aware via signer   | leaks                 |
| **cell (a) B.1+VA**      | no (single capture)    | partial (unchanged)        | **1 (2 atoms)**             | rotation-aware via wrap   | **closed**            |
| **cell (b) B.2+VA**      | yes, explicit          | partial (unchanged)        | **1 (2 atoms)**             | rotation-aware via wrap   | **closed**            |
| **cell (c) B.1+VA rot**  | n/a (no two-site)      | wrapper invisible          | **+1 only on version bump** | rotation-aware            | **closed**            |
| **cell (d) B.2+VA rot**  | n/a (no two-site)      | wrapper invisible          | **+1 only on version bump** | rotation-aware            | **closed**            |

Two takeaways from the table:

- The wrapper takes B.2's worst-cell number (reads=3 for 2 atoms) and
  replaces it with B.1's best-cell number (reads=1) — without
  requiring B.1's structural close-over. B.2 becomes ergonomically
  cheap.
- The "rotation default" column flips from `stale` / `partly aware` to
  uniformly `rotation-aware` across all four cells. The cost is +1
  underlying read at version-bump time, amortised across all
  subsequent reads of the new version.

## 6. Q1 ADR NARROWING ASSESSMENT

Spike #3 §6 framed Q1 as collapsing from "A vs B" to **"B.1 vs B.2 vs
B + version-aware-resolver"**. This spike's evidence narrows that
three-option framing further:

- **B.1 alone (no wrapper) is now structurally weaker than it looked
  in spike #3.** B.1's appeal was reads=1 in the steady-state two-site
  case at the cost of rotation-blindness. The wrapper preserves the
  reads=1 property AND adds rotation safety — so "B.1's appeal" is
  now subsumed by "B + wrapper".

- **B.2 + wrapper is functionally equivalent to B.1 + wrapper on every
  observable this spike measured.** Cells (a)+(b) and (c)+(d) show
  byte-identical traces. The wrapper makes the choice between
  close-over and re-resolve a stylistic preference at the adapter
  authoring level; runtime behaviour is the same.

**Direction the ADR leans:** ship `B + version-aware-resolver` as the
kit default — adapters call `secrets.resolve(name)` whenever they
need the secret, the wrapper handles caching + version-stamp. The
B.1 vs B.2 sub-cell decision becomes adapter-author style, not a kit
contract.

**What firms up vs stays open:**

- **Carry-forward #7 (version-aware resolver default) — FIRMS UP.**
  This spike is the empirical probe; the wrapper does what it
  promised. Brain can confidently elevate version-aware-by-default
  into the kit's resolver shape proposal at synthesis time.
- **Carry-forward #8 (adapter reconstruction as Composer concern) —
  STAYS OPEN, but its scope shrinks.** The wrapper closes the leak
  for re-readable secret consumers (cells a-d all close-over OR
  re-resolve secrets that are *strings*). Adapter reconstruction
  remains load-bearing for non-re-readable resources (long-lived
  connections, pre-signed URLs, anything where the secret is baked
  into a stateful resource at construction time and cannot be
  re-evaluated). Brain should keep #8 open under that narrower scope.
- **Carry-forwards #1 / #5 / #9 / #10 (rotation semantics, async
  factory ergonomics, two-site contract docs) — UNCHANGED, see §7.**

The kit-shape sentence brain can now defensibly write: *"The default
SecretsResolver in pipeline-kit is version-aware; adapters call
`resolve(name)` freely and pay only the cost of a `stats(name)`
sync probe per call plus one underlying read per name per version."*

## 7. CARRY-FORWARD UPDATES

Re-listing spike-#3 §8 carry-forwards (#1–10) with status updates from
this spike's evidence.

1. **Rotation semantics.** **REFINED.** `invalidate(name)` remains
   load-bearing — the wrapper relies on `stats(name).current_version`
   bumping after invalidate to trigger cache-drop. The wrapper does
   NOT need a `subscribe(name, onChange)` push API; pull-via-stats is
   sufficient under this evidence. TTL is a separate composition
   layer; not probed here.

2. **Cache scope as ADR.** **REFINED.** The wrapper places the cache
   at resolver-construction lifetime — i.e. the wrapper instance
   lives wherever the user constructs it (typically once per process
   or once per pipeline). Adapter-level caches become unnecessary if
   the kit ships the wrapper as default. Brain should phrase the
   ADR as "cache lives on the resolver wrapper; adapters do not
   manage caching themselves".

3. **SOPS / file-backed resolver ergonomics.** **UNCHANGED.** Mock-only
   spike. Stays open.

4. **Multi-secret pipelines + scoping.** **UNCHANGED.** Single-secret
   spike. Carries to spike #4 leg-2.

5. **Construction-time secrets.** **UNCHANGED.** Spike-#3's verdict
   stands: B has a real factory site; A has none. This spike does
   not re-probe A.

6. **Stage-typed Secrets vs ambient ctx vs deps.** **UNCHANGED.**
   Spike doesn't expand surface to other infra deps.

7. **Version-aware resolver default.** **RESOLVED — adopt.** This
   spike was the probe. Empirically the wrapper closes both leaks
   (read inflation under B.2, cross-run staleness under B-CoA/B-CoR)
   while preserving B.1's reads=1 ergonomics. Brain can lock the
   ADR as "ship version-aware resolver as the kit's default
   resolver wrapper".

8. **Adapter reconstruction as a Composer concern.** **REFINED — scope
   shrinks.** Closed for re-readable secret consumers (strings).
   Stays open for non-re-readable resources (long-lived connections,
   handshake-time credentials, pre-signed URLs). Brain should
   re-frame #8 from "adapter reconstruction in general" to "adapter
   reconstruction for non-re-readable resources only".

9. **Async factory ergonomics.** **UNCHANGED.** This spike preserves
   spike-#3's `Promise<Result<Source<O>, E>>` factory shape; the
   wrapper does not change it. Cat I / Cat IV joint review still
   applicable.

10. **Two-site contract in adapter docs.** **REFINED.** Under the
    wrapper, the two-site contract becomes "adapter calls
    `secrets.resolve(name)` at any site that needs the secret;
    runtime cost is bounded by the wrapper's cache". The
    documented convention shrinks: brain may not need the
    `*AtConstruction` / `*PerRequest` naming convention at all if
    the wrapper makes resolve calls cheap. Stays open as a docs
    decision; the type-level question is gone.

**New carry-forward from this spike:**

11. **Wrapper composition with TTL / push-rotation layers.** The
    spike's wrapper is pull-only via stats version stamp. A real
    deployment may want TTL-bounded caching (drop entries after N
    seconds regardless of version) or push-rotation
    (`subscribe(name, onChange)` from the underlying resolver). The
    wrapper's interface is small enough that these can be layered
    on top — `createTtlResolver(createVersionAwareResolver(real),
    ttlMs)` is a natural composition. Whether the kit ships TTL as
    a separate wrapper or as a parameter to the version-aware
    wrapper is an ADR question. Out of spike scope; flag for
    Cat VIII synthesis or a future spike.

## 8. WHAT SPIKE #5 / SYNTHESIS MUST STILL ANSWER

### Spike #4 leg-2 — multi-secret pipeline (unchanged plan)

Per spike-#3 §9 and spike-#2 §8.4. Construct a pipeline where one
Source needs `apify-token` and a downstream Store needs
`supabase-service-role`. Stress naming convention vs structural scope
under variant B + version-aware wrapper. Re-visit variant C briefly
IF leg-2 evidence suggests composition tax under multi-secret is
itself a tractable shape. Leg-1's evidence does NOT change leg-2's
plan; leg-2 should now be run with the wrapper in place by default,
which simplifies the harness shape (the cache layer is a given).

### What carries to synthesis vs needs more spikes

**Now answerable at synthesis (no further spike needed):**

- Q1 ADR narrowing — see §6. `B + version-aware-resolver` is the
  defensible default.
- Carry-forward #7 — adopt the wrapper. See §7.
- Carry-forward #2 (cache scope) — cache lives on the wrapper. See §7.

**Still needs evidence (spike #5 candidates if scoped):**

- Carry-forward #8 narrow scope — non-re-readable resource adapter
  reconstruction. Would need a fixture where the adapter holds a
  stateful resource (e.g. an open HTTP/2 stream) built from a
  credential, and a Composer signal that triggers reconstruction.
  Probably worth a small leg-3 spike before synthesis IF brain
  decides the kit ships an adapter-reconstruction primitive.
- Carry-forward #11 — TTL composition / push-rotation. Could be
  answered at synthesis if brain locks "pull-only via stats is the
  kit's default; TTL is a user-glue layer". A spike would only be
  needed if brain wants empirical ergonomics.

### What synthesis still needs from leg-2 evidence (out of this dispatch)

- Whether multi-secret pipelines need a different cache-key
  granularity (cache-per-name vs cache-per-namespace).
- Whether cross-adapter secret sharing (Source's `apify-token` and
  Store's `apify-token` if both reference the same name) collide on
  the wrapper's cache, and whether that's desirable.
- Whether adapter-author ergonomics under multiple secret deps
  surface a naming convention need that single-secret spikes did
  not.

## 9. HONEST SCOPE BOUND

This spike did NOT probe:

- Real backends (SOPS, age, 1Password, Vault, AWS SM, GCP SM). Mock-
  only.
- Push-rotation (`subscribe(name, onChange)` on the underlying
  resolver). Pull-only via `stats(name)` by design.
- TTL-based caching. Pure version-stamp; carry-forward #11.
- Multi-secret pipelines. Spike #4 leg-2.
- Variant C re-entry. Spike #3 §7 said NOT triggered; this spike
  inherits that verdict.
- Variant A under wrapper. Spike #3 §6 firmed up B as the natural
  fit; wrapping A would not have changed that.
- Non-re-readable resources (long-lived TCP connections, HTTP/2
  streams, pre-signed URLs). Carry-forward #8 narrow scope.
- Concurrent `resolve(name)` calls (race conditions on the wrapper's
  cache map). Single-threaded JS event loop, single-atom-at-a-time
  harness; no thundering-herd or stampede protection probed.
- Performance under load (read latency, cache-map memory growth).
  Mock-only, two-atom harness; no metric collection beyond read
  counts.

What this spike DID empirically establish: a 65-LOC version-aware
caching wrapper around the spike-#3 mock resolver collapses the B.1
vs B.2 observables across two harnesses with four cells, closes both
leaks spike #2 / spike #3 documented, and preserves the reads=1
ergonomic property of B.1 without requiring B.1's structural
close-over.

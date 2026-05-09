# Cat VIII Spike #2 — `rotation-mid-run` Findings

> Spike: rotation-mid-run harness over variants A and B (B in two
> sub-cases) from spike #1. Stresses the spike-#1 §7 verdict and
> answers spike-#1 §8 carry-forwards Q1 (rotation semantics) + Q2
> (cache scope as ADR).
> Branch: `v1-cat-VIII-spike-2-rotation`. Author: Executor — 2026-05-09.
> Companion to: `docs/research-outline-v1.md` § Category VIII (Identity / Secrets).
> Status: spike output (NOT a notes file; brain synthesises a notes-v1-cat-VIII.md later).
> Friction anchor: `F-AUTH` — top-15 #2, 9/9 universality.

## 1. WHAT WAS BUILT

A 2-variant TS spike forking the spike-#1 mock and harness. The mock
resolver gains two affordances:

- `invalidate(name)` — bumps a per-secret version counter and rotates the
  underlying value to `<base>-rotated-v<n>` so observers see a different
  string post-invalidate.
- `stats(name)` — returns `{ reads, current_version }` so the harness can
  prove "did the resolver actually re-fetch from source?" empirically.

The mock itself does no caching. Caching is the *adapter's* problem, per
FINDINGS-1 §5: "the location of the resolver call **is** the caching
surface."

Three observable cells under the same rotation event:

- **Variant A** (`variant-a-rotation.ts`) — `ctx.secrets.resolve(...)`
  inside `Source.iter()`, with a `createRunScopeCache(real)` wrapper
  attached to `ctx.secrets` per run. Two runs in one process; the
  underlying real resolver is shared.
- **Variant B sub-case CoA** (cache-on-adapter, in
  `variant-b-rotation.ts`) — adapter caches the resolved token in a
  closure variable. Adapter constructed once, reused across both runs.
- **Variant B sub-case CoR** (cache-on-resolver, same file) — adapter
  does no caching. A `createCachingResolver(real)` wrapper sits between
  adapter and real resolver, lives at adapter-construction lifetime.
  Adapter (and so wrapper) reused across both runs.

**Not in scope** (deferred to spike #3+): real SOPS / age / 1Password /
env-var hybrid backends; multi-secret-per-pipeline; construction-time vs
run-time secrets; push-rotation `subscribe(name, onChange)` patterns;
TTL semantics.

## 2. THE ROTATION SCENARIOS

Three observable cells, one rotation event mid-RUN-#1 in each. All cells
print `reads=N current_version=vM` after every observable step so the
staleness window is visible directly.

### 2.1 Variant A — ctx.secrets + run-scope cache wrapper

```
--- variant-a: RUN #1 atom 1 (cold cache) ---
[variant-a] run1.atom1 OK atom pk_atom_VARIANT_A_run_1 token_seen="apify-tok-v1"
[variant-a] run1.atom1 (real) reads=1 current_version=v1
--- variant-a: RUN #1 atom 2 (warm cache, no rotation yet) ---
[variant-a] run1.atom2 OK atom pk_atom_VARIANT_A_run_1 token_seen="apify-tok-v1"
[variant-a] run1.atom2 (real) reads=1 current_version=v1
--- variant-a: invalidating apify-token on REAL resolver ---
[variant-a] post-invalidate (real) reads=1 current_version=v2
--- variant-a: RUN #1 atom 3 (post-rotation, same ctx → expect STALE) ---
[variant-a] run1.atom3 OK atom pk_atom_VARIANT_A_run_1 token_seen="apify-tok-v1"
[variant-a] run1.atom3 (real) reads=1 current_version=v2
--- variant-a: RUN #2 atom 1 (fresh ctx → expect ROTATED value) ---
[variant-a] run2.atom1 OK atom pk_atom_VARIANT_A_run_2 token_seen="apify-tok-v1-rotated-v2"
[variant-a] run2.atom1 (real) reads=2 current_version=v2
```

Reads on the real resolver: 1 across all of run #1 (the wrapper served
the cached value for atoms 2 and 3). 2 after run #2 (a fresh wrapper
forced a fetch). The `token_seen` jump from `apify-tok-v1` to
`apify-tok-v1-rotated-v2` between runs is the run-scope-cache property
in its honest form: stale within a run, current at run boundary.

### 2.2 Variant B — cache-on-adapter (CoA)

```
--- B-CoA: RUN #1 atom 1 (cold cache) ---
[variant-b] run1.atom1 OK atom pk_atom_VARIANT_B_CoA_run_1 token_seen="apify-tok-v1"
[variant-b] run1.atom1 (real) reads=1 current_version=v1
--- B-CoA: RUN #1 atom 2 (warm cache, no rotation) ---
[variant-b] run1.atom2 OK atom pk_atom_VARIANT_B_CoA_run_1 token_seen="apify-tok-v1"
[variant-b] run1.atom2 (real) reads=1 current_version=v1
--- B-CoA: invalidating apify-token on REAL resolver ---
[variant-b] post-invalidate (real) reads=1 current_version=v2
--- B-CoA: RUN #1 atom 3 (post-rotation, same adapter+ctx → expect STALE) ---
[variant-b] run1.atom3 OK atom pk_atom_VARIANT_B_CoA_run_1 token_seen="apify-tok-v1"
[variant-b] run1.atom3 (real) reads=1 current_version=v2
--- B-CoA: RUN #2 atom 1 (fresh ctx, REUSED adapter → expect STALE LEAK) ---
[variant-b] run2.atom1 OK atom pk_atom_VARIANT_B_CoA_run_2 token_seen="apify-tok-v1"
[variant-b] run2.atom1 (real) reads=1 current_version=v2
```

Reads: 1 across the entire two-run lifetime. The adapter served the same
pre-rotation token for run #2's atom 1 — `apify-tok-v1`, not the rotated
`apify-tok-v1-rotated-v2`. The closure cache outlives the run.

### 2.3 Variant B — cache-on-resolver (CoR)

```
--- B-CoR: RUN #1 atom 1 (cold cache) ---
[variant-b] run1.atom1 OK atom pk_atom_VARIANT_B_CoR_run_1 token_seen="apify-tok-v1"
[variant-b] run1.atom1 (real) reads=1 current_version=v1
--- B-CoR: RUN #1 atom 2 (warm cache) ---
[variant-b] run1.atom2 OK atom pk_atom_VARIANT_B_CoR_run_1 token_seen="apify-tok-v1"
[variant-b] run1.atom2 (real) reads=1 current_version=v1
--- B-CoR: invalidating apify-token on UNDERLYING real resolver ---
[variant-b] post-invalidate (real) reads=1 current_version=v2
--- B-CoR: RUN #1 atom 3 (post-rotation → expect STALE on caching wrapper) ---
[variant-b] run1.atom3 OK atom pk_atom_VARIANT_B_CoR_run_1 token_seen="apify-tok-v1"
[variant-b] run1.atom3 (real) reads=1 current_version=v2
--- B-CoR: RUN #2 atom 1 (fresh ctx, REUSED adapter+wrapper → expect STALE LEAK) ---
[variant-b] run2.atom1 OK atom pk_atom_VARIANT_B_CoR_run_2 token_seen="apify-tok-v1"
[variant-b] run2.atom1 (real) reads=1 current_version=v2
```

Behaviour identical to CoA at the observable level: reads=1 throughout
both runs, run #2 sees stale `apify-tok-v1`. The cache-on-resolver
shape doesn't fix anything — it just relocates the same staleness.

## 3. WHAT THE EVIDENCE SHOWS

Three dimensions, three observations:

1. **Within-run staleness window (after rotation, same ctx).** All three
   cells serve the pre-rotation value. Variant A, B-CoA, and B-CoR are
   *equivalent* here. The cache scope doesn't matter within a run — once
   a value is cached anywhere on the read path, the run sees stale
   until something invalidates *that specific cache*.

2. **Across-run rotation visibility (fresh ctx, same process).**
   Variant A *diverges*: run #2's fresh ctx forces a fresh wrapper
   forces a fetch, so run #2 sees the rotated value (`...-rotated-v2`,
   reads=2). Variant B (both sub-cases) *do not*: run #2's fresh ctx is
   irrelevant because the cache lives outside ctx (in the adapter
   closure for CoA, in the wrapper for CoR). reads stays at 1; run #2
   keeps serving the pre-rotation token. **This is the run-scope cache
   property under empirical observation: it's real and observable.**

3. **Cache-clearing semantics.** None of the three caches cleared
   themselves on `real.invalidate(...)` — the wrapper passes
   `invalidate` through to the underlying resolver, which is honest:
   the wrapper was never told its cache should drop the entry. To clear
   under variant A you replace the ctx (run boundary). To clear under
   variant B-CoA you'd need a new adapter API
   (`adapter.refreshSecrets()`). To clear under variant B-CoR you'd
   need either a new wrapper API or a smarter wrapper that re-checks
   `stats(name).current_version` on each read. Each option is a
   distinct ADR.

## 4. CACHE SCOPE AS ADR (carry-forward Q2)

The spike-#1 §5 theoretical framing **holds under empirical observation**:

- Variant A's cache is per-pipeline-run by construction. ctx is built
  per run; the wrapper is built per run; lifetime aligns with the run.
- Variant B-CoA's cache is per-adapter-instance. Lifetime ≥ adapter
  lifetime, which can be (and in this spike is) longer than a run.
- Variant B-CoR's cache is per-resolver-wrapper-instance. Same lifetime
  semantics as B-CoA — the wrapper just relocates the storage.

The **security-posture difference is real**:

- Variant A's default leak surface is "stale value within the same
  run". Cross-run leak requires the user to actively reuse a ctx —
  unusual and discoverable.
- Variant B's default leak surface is "stale value forever, until the
  adapter (or wrapper) is reconstructed". Cross-run leak is the *zero
  effort* path. Avoiding it requires the user to know they should
  rebuild the adapter per run, which contradicts the natural
  "construct once at boot, reuse across runs" server pattern.

For a kit whose F-AUTH catalog evidence (9/9 projects) shows real
rotation pain, **B's default leak surface is the more dangerous one**.
A's leak window is bounded by the run; B's is unbounded. This is a
non-trivial empirical reversal of the spike-#1 §7 narrow lean toward B.

What the spike does *not* probe (open for ADR drafting):

- A "rebuild adapter per run" convention could close B's leak window
  but adds construction-cost per run, which interacts with adapter
  warm-up cost (HTTP keep-alive pools, paginators, etc. — Cat IV / Cat
  VII territory).
- A version-tag check on every read (wrapper compares cached version
  vs `stats(name).current_version`) could close both A's within-run
  staleness and B's cross-run leak, but adds a stat call per read
  which moves the "every read goes to source" cost back onto the kit.
- TTL caching is plausible but unprobed in this spike.

## 5. ROTATION SEMANTICS (carry-forward Q1)

Three concrete observations:

1. **The kit DOES need a `resolver.invalidate(name)` affordance.**
   Without it there's no language for "I rotated upstream, please drop
   any cached values". The spike's mock has it; without that the
   harness couldn't even simulate rotation. Brain should treat
   `invalidate(name)` as on the SecretsResolver interface, not optional.

2. **Adapters CANNOT detect rotation themselves** without an explicit
   signal. The wrappers and closures in this spike are blind to
   underlying rotation by default. Two ways out:
   - **Pull**: each `resolve()` consults `stats(name).current_version`
     and drops cache if version changed. Costs one extra call per
     read. Cheap if `stats` is in-process; expensive if it's a
     network round-trip to a real backend.
   - **Push**: a `subscribe(name, onChange)` affordance where the
     resolver tells caches to drop. Cleaner per read, but adds a new
     resolver API surface (subscriptions, error semantics, lifecycle)
     that's a non-trivial kit-shape commitment. **Not probed in this
     spike — open for spike #3+.**

3. **TTL / version-tag patterns look load-bearing but unprobed.** The
   spike's stats already exposes `current_version`; a version-tag
   pattern (cache stores `{value, version}`, on read compare to
   current) would empirically close the within-run staleness window
   and the cross-run leak both. Whether kit should bake it in by
   default vs leave it as user-glue is a real ADR. **Not probed in
   this spike — open for spike #3+.**

## 6. DOES THE SPIKE-#1 §7 VERDICT FIRM UP OR COLLAPSE?

**MIXED.** The spike-#1 §7 narrow lean toward B was defended on
discoverability grounds ("which adapter uses which secret is
visible at construction"). That part still holds. But on the rotation
axis specifically, **A and B observably diverge, and the divergence
cuts against B**:

- **Within-run** (atoms 1 → 2 → invalidate → 3): A, B-CoA, and B-CoR
  are equivalent. All three serve stale.
- **Across-run** (run #1 → run #2): A's fresh ctx forces a fresh fetch
  and sees the rotated value. B's reused adapter (both sub-cases)
  serves the pre-rotation value indefinitely.

Spike #1 §7 said "B narrowly day-1 least-bad over A". On the rotation
axis this spike inverts that on one specific dimension (cross-run leak)
while leaving B's discoverability advantage intact. The honest day-2
read:

- B is *still* better on discoverability ("this adapter declares its
  secret needs at construction").
- A is *empirically* better on default-rotation-safety (a fresh run
  sees fresh secrets without the user having to know about adapter
  reconstruction).
- The two advantages live on orthogonal axes. Picking one without
  acknowledging the loss on the other is dishonest.

**Three ways out for brain to consider:**

1. Pick B + add a kit-level convention/API forcing per-run adapter
   construction (or a `kit.refresh()` hook between runs). Trades
   construction cost for discoverability.
2. Pick A + add a kit-level convention forcing all infra deps onto ctx
   (consistent ambient pattern). Loses discoverability; risks the
   ctx-as-god-object failure mode spike #1 named.
3. Pick a hybrid: secrets via deps (B-shape) for discoverability, but
   the resolver kit gives users is itself version-aware (drops cache
   on read if version moved) and short-TTL by default. Closes the
   leak without forcing a construction pattern. Costs one stats-call
   per resolve, which is acceptable in-process and expensive at network.
   This is the option that needs spike #3+ to evaluate against a real
   backend.

**Do not lock the ADR on spike #2 evidence alone.** The evidence here
is enough to falsify the simple "B is fine" reading; it is not enough
to lock between the three remediation paths.

## 7. CARRY-FORWARD UPDATES

Re-listing spike #1 §8 carry-forwards with updates from this spike's evidence.

1. **Rotation semantics.** **REFINED.** `invalidate(name)` is load-bearing
   for the resolver interface — without it there's no rotation
   vocabulary at all, kit-side. `subscribe(name, onChange)` and
   TTL/version-tag patterns are plausible but unprobed; open for
   spike #3+.

2. **Cache scope as ADR.** **REFINED toward stronger evidence.** The
   spike-#1 §5 theoretical framing held under observation; the
   security-posture asymmetry is real and quantifiable (A: bounded by
   run; B: unbounded by default). Brain has empirical grounding to
   draft an ADR; the ADR should specify both default and escape hatch.

3. **SOPS / file-backed resolver ergonomics.** **UNCHANGED.** Mock-only
   spike; no real backend probed. Stays open for spike #3+.

4. **Multi-secret pipelines + scoping.** **UNCHANGED.** Single-secret
   spike. Stays open for spike #4.

5. **Construction-time secrets.** **UNCHANGED.** Run-time-only spike.
   Stays open for spike #3.

6. **Stage-typed Secrets vs ambient ctx vs deps — kit-shape coherence.**
   **UNCHANGED.** Spike doesn't expand the surface to other infra deps;
   kit-shape question stays at brain level.

**New carry-forwards from spike #2:**

7. **Version-aware resolver default.** Should the kit's standard
   resolver consult `stats(name).current_version` on each read and
   drop cached values when the version moves? This closes the
   observed cross-run leak under variant B and the within-run
   staleness under variant A. Costs one stats call per resolve. Need
   to evaluate against a real backend to know if cost is real-world
   tolerable. Spike #3+ should probe.

8. **Adapter reconstruction as a Composer concern.** If brain locks
   variant B, the cross-run leak is mitigated only if adapters are
   reconstructed per run. Should the Composer own adapter lifecycle
   (force per-run construction) or should the user own it (current
   spike-#1 implication)? This crosses Cat VIII into Cat I/Composer
   territory — flag for joint discussion.

## 8. WHAT SPIKE #3 / #4 MUST STILL ANSWER

### Spike #3 — construction-time vs run-time secrets

Build an Apify-style adapter where:

- the secret is needed at HTTP-client construction time (interceptor
  installs `Authorization: Bearer <token>` once);
- the secret is *also* needed at run time (per-request mint from a
  refresh token or per-call header).

Stress both variant A and variant B. The question: does either shape
naturally express "resolve at factory time AND re-resolve in iter"
without forcing a duplication? If neither does, that's an empirical
case for the spike-#1 variant C (typed Secrets stage) or for a third
shape not yet surfaced.

This spike **must also probe** the new carry-forward #7 (version-aware
resolver) — running the existing rotation harness against a
version-aware caching wrapper to show whether the leak closes
empirically.

### Spike #4 — multi-secret pipeline

Construct a pipeline where one Source needs `apify-token` and a
downstream Store needs `supabase-service-role`. Stress:

- naming convention: flat names vs hierarchical
  (`apify.token` vs `apify-token`);
- structural scope: `secrets.scope('apify').resolve('token')` vs flat;
- discoverability: does variant B's deps shape stay readable when an
  adapter wants three secrets? Does the user write
  `{ secrets: { apify: ..., supabase: ..., webhook: ... } }` or one
  flat resolver?

Cross-cuts Cat IV (config trees) — flag for joint review.

Neither #3 nor #4 should be pre-judged on this spike's evidence. Spike
#2's empirical contribution is bounded: it falsified the simple
"variant B is fine" reading on one specific axis (cross-run rotation
leak) and elevated `invalidate(name)` from optional to load-bearing
for the resolver interface. Everything else stays open.

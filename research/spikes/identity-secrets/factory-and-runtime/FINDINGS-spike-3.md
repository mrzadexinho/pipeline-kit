# Cat VIII Spike #3 — `factory-and-runtime` Findings

> Spike: two structural placements (A and B) over an Apify-shaped HTTP-client
> mock that needs the same secret at TWO sites — once at HTTP-client
> construction (factory) and once per request (signer).
> Branch: `v1-cat-VIII-spike-3-factory-and-runtime`. Author: Executor — 2026-05-09.
> Forked from spike #2 (master tip cea957e at branch creation).
> Companion to: `docs/research-outline-v1.md` § Category VIII (Identity / Secrets).
> Status: spike output (NOT a notes file; brain synthesises a notes-v1-cat-VIII.md later).
> Friction anchor: `F-AUTH` — top-15 #2, 9/9 universality.

## 1. WHAT WAS BUILT

Three observable cells over a single shared mock + HTTP-client fixture
pair:

- **Variant A — `ctx.secrets`, deferred construction (A.2 + A.3).** No
  factory-stage signal exists in A's shape (no ctx at factory time), so
  the bearer resolve is deferred into `iter()` first call (A.2), and the
  signer closure also reads from `ctx.secrets` (A.3). Both resolution
  sites live inside `iter()`. The `httpClient` is built lazily on first
  iter, so we get one bearer resolve plus N per-atom signer resolves.
- **Variant B sub-cell B.1 — close-over.** Factory resolves
  `apify-token` once; both bearer site (HTTP client interceptor) and
  signer closure capture the same factory-time string. Single resolve
  total, regardless of atom count.
- **Variant B sub-cell B.2 — re-resolve at run-time.** Factory resolves
  `apify-token` once for HTTP-client construction; signer closure
  re-resolves on every call via `deps.secrets`. Two resolution sites,
  two reads per atom (one factory + one per signer call).

Shared fixtures:

- `mock-secrets-resolver.ts` — forked verbatim from spike #2; `resolve` /
  `invalidate` / `stats`; same error envelope. Rotation NOT stressed
  (spike #2 covered; affordances kept for spike #4 re-stress).
- `mock-apify-http-client.ts` — node-stdlib-only HTTP-client fixture.
  Factory takes `bearerToken: string` (closed over) plus
  `signRequest: (atomId) => Promise<Result<string, ApifyHttpError>>`
  (called per request). "Fires" via `console.log`. `node:crypto` HMAC-SHA256
  for the throwaway 16-hex-char per-call id. NO real network.

Two atoms per cell so per-request behaviour is observable.

## 2. THE TWO-SITE SCENARIOS

Verbatim run output (from `bash run-spike-3.sh`):

### 2.1 Variant A — ctx.secrets + deferred construction

```
==> [1/2] Variant A — ctx.secrets, deferred-construction (A.2 + A.3)
### CELL A — variant A, ctx.secrets, deferred-construction (A.2 + A.3) ###
[variant-a] initial (real) reads=0 current_version=v1
[variant-a] pre-request pk_atom_VARIANT_A_01 bearer_token_resolved_count(*)=1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=c94ff8b47f0d6c5f atom=pk_atom_VARIANT_A_01
[variant-a] post-request pk_atom_VARIANT_A_01 signer_resolved_count(*)=2
[variant-a] OK atom pk_atom_VARIANT_A_01 job=apify_run_pk_atom_VARIANT_A_01 status=200 call_id=c94ff8b47f0d6c5f
[variant-a] pre-request pk_atom_VARIANT_A_02 bearer_token_resolved_count(*)=2
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=1e2647ad2c7892d5 atom=pk_atom_VARIANT_A_02
[variant-a] post-request pk_atom_VARIANT_A_02 signer_resolved_count(*)=3
[variant-a] OK atom pk_atom_VARIANT_A_02 job=apify_run_pk_atom_VARIANT_A_02 status=200 call_id=1e2647ad2c7892d5
[variant-a] final (real) reads=3 current_version=v1
```

### 2.2 Variant B sub-cell B.1 — close-over

```
### CELL B.1 — variant B, close-over (factory-only resolve, both sites) ###
[variant-b] initial (real) reads=0 current_version=v1
[variant-b] post-factory (real) reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=6bb0180c057d72f9 atom=pk_atom_VARIANT_B_B1_01
[variant-b] B.1 post-request pk_atom_VARIANT_B_B1_01 reads=1
[variant-b] B.1 OK atom pk_atom_VARIANT_B_B1_01 call_id=6bb0180c057d72f9
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=d3601469ca099a7b atom=pk_atom_VARIANT_B_B1_02
[variant-b] B.1 post-request pk_atom_VARIANT_B_B1_02 reads=1
[variant-b] B.1 OK atom pk_atom_VARIANT_B_B1_02 call_id=d3601469ca099a7b
[variant-b] final (real) reads=1 current_version=v1
```

### 2.3 Variant B sub-cell B.2 — re-resolve at run-time

```
### CELL B.2 — variant B, re-resolve at run-time (factory + per-atom) ###
[variant-b] initial (real) reads=0 current_version=v1
[variant-b] post-factory (real) reads=1 current_version=v1
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=aecf2166ed0e090b atom=pk_atom_VARIANT_B_B2_01
[variant-b] B.2 post-request pk_atom_VARIANT_B_B2_01 reads=2
[variant-b] B.2 OK atom pk_atom_VARIANT_B_B2_01 call_id=aecf2166ed0e090b
[apify-http] POST /v1/actors/apify/web-scraper/runs bearer=apify-tok-v1 call_id=91ba2eab9aa68961 atom=pk_atom_VARIANT_B_B2_02
[variant-b] B.2 post-request pk_atom_VARIANT_B_B2_02 reads=3
[variant-b] B.2 OK atom pk_atom_VARIANT_B_B2_02 call_id=91ba2eab9aa68961
[variant-b] final (real) reads=3 current_version=v1
```

Read-count ledger across cells:

| Cell           | post-factory reads | reads after atom 1 | final reads (after atom 2) |
| -------------- | ------------------ | ------------------ | -------------------------- |
| A (deferred)   | n/a (no factory)   | 2                  | 3                          |
| B.1 close-over | 1                  | 1                  | 1                          |
| B.2 re-resolve | 1                  | 2                  | 3                          |

The single most diagnostic number is the post-factory column — only B
*has* a post-factory snapshot, because only B *has* a factory site.

## 3. WHAT THE EVIDENCE SHOWS

Per cell, the two observable questions:

### 3.1 Variant A — deferred construction (A.2 + A.3)

- **(a) Did the shape force duplication?** *Effectively yes, but
  relocated.* A has no factory site, so the bearer resolve and the
  signer's run-time resolve both live inside `iter()`. The bearer is
  resolved ONCE on the first iter call (lazy cache on closure variable
  `httpClient`), and the signer re-resolves on every atom. Look at
  `variant-a-factory-runtime.ts` lines 86–110 — the `if (httpClient ===
  undefined)` guard at line 88 plus the `signRequest` closure at lines
  98–110 are the two read sites. They are visually adjacent but
  semantically distinct: one fires once, the other fires N times. The
  duplication isn't "two near-identical resolution calls" — it's
  "factory resolve relocated into iter, plus run-time resolve, both
  reading the same secret name from the same `ctx.secrets` reference".
  The READ-COUNT cost matches B.2 exactly (3 reads for 2 atoms), but
  the factory shape is implicit rather than explicit.

- **(b) Type-level visibility of the two sites?** *No.* TS sees
  `iter(ctx)` as one function body. Both reads are `await
  ctx.secrets.resolve('apify-token')` calls inside the same async
  generator. Forgetting one or the other is a logic bug invisible to
  the compiler. There is no signature anywhere that says "this Source
  needs apify-token at construction" vs "...at request time".

### 3.2 Variant B sub-cell B.1 — close-over

- **(a) Did the shape force duplication?** *No — and that's the
  problem.* The factory captures `tokenAtFactory` and BOTH the bearer
  site (HTTP client `bearerToken: tokenAtFactory`) and the signer
  closure (`signRequest: async (atomId) => ok(mintCallId(tokenAtFactory,
  atomId))`) read from the same captured variable. See
  `variant-b-factory-runtime.ts` lines 79–96 (factory body); the single
  resolve is at line 87 and the close-over capture into both bearer and
  signer sites is at lines 93–96. Single resolve, single
  source-of-truth — but the signer is structurally blind to rotation
  (spike #2 §6 territory; flagged here as the trade B.1 makes by
  default).

- **(b) Type-level visibility?** *Partial.* The factory's `await
  secrets.resolve('apify-token')` is in plain sight at the top of the
  factory function. The fact that the signer reads from the same
  closed-over string (rather than from `secrets`) is invisible at the
  type level — the signer's type signature is identical to B.2's. A
  reader has to read the closure body to know the difference.

### 3.3 Variant B sub-cell B.2 — re-resolve at run-time

- **(a) Did the shape force duplication?** *Yes, and visibly so.* See
  `variant-b-factory-runtime.ts` lines 139–167. Line 147 is the factory
  resolve: `const tokenResult = await secrets.resolve('apify-token')`.
  Lines 155–166 are the signer closure's per-call resolve via the SAME
  `secrets` reference (`const live = await secrets.resolve('apify-token')`
  at line 156). Two `secrets.resolve('apify-token')` calls in the same
  function body, one inside the factory, one inside the signer
  closure. This is "resolve in factory + re-resolve in iter"
  duplication in its naked form — and it's exactly what spike-#1 §6
  predicted variant C cannot avoid via composition. **The duplication
  is honest about what's happening (two read sites), and it costs the
  exact same read count as variant A (3 reads for 2 atoms).**

- **(b) Type-level visibility?** *Better than A; not perfect.* The
  factory function signature
  `(args, deps) => Promise<Result<Source<...>, ...>>` already declares
  that construction can fail with `SecretsError`, which surfaces the
  factory-time read at the type level. The signer closure's resolve is
  still inside an arrow body, so TS doesn't enforce that two sites
  exist. But anyone reading the factory body sees both sites as
  textually distinct calls — they are 12 lines apart, not 12 chars.

## 4. CONSTRUCTION-TIME vs RUN-TIME (Q5 update)

Spike #1 §6 named this as variant C's killer ("variant C cannot express
'Source needs the apify-token at HTTP-client construction time, then
again per-request'"). Spike #2 carry-forward #5 was UNCHANGED. This
spike is the empirical probe.

What the two-site shape exposes that single-site spikes did not:

1. **Variant A literally has no factory site.** A factory under variant
   A is a concept-error: at `createApifySource(args)` time there is no
   `ctx`, hence no `secrets`. To get a factory in A you must defer it
   into `iter()`'s first-call branch (A.2). What looks like "factory
   resolve" in A is actually "first-iter resolve". This is the kind of
   shape distinction that single-site spikes (spike #1, spike #2)
   couldn't surface because there was nothing to lift outside `iter()`
   in the first place.

2. **Variant B has a real factory site.** `createApifySource(args, {
   secrets })` — both `args` and `secrets` are in scope at construction.
   The factory can `await secrets.resolve(...)` and stamp the result
   onto a long-lived HTTP client interceptor. **This is the cleanest
   structural fit for the construction-time/run-time pattern observed
   to date in this Cat VIII evidence.** The cost is that the factory
   becomes async (returns `Promise<Result<Source<O>, E>>`), which is a
   real ergonomic change but not a deal-breaker.

3. **B.1 vs B.2 collapses the question to a different one: "do you
   accept rotation staleness or duplicated reads?".** B.1 single-
   resolves and is structurally stale to rotation. B.2 double-reads
   per atom and is rotation-aware via the signer site only (the bearer
   site stays stale unless the HTTP client is rebuilt). Neither
   sub-cell solves both. The four-shape question raised by the
   construction-time/run-time stress is: "should the bearer site be
   re-resolved too, by reconstructing the HTTP client on rotation
   signal?" That's a Composer-level concern, not an adapter-shape one.
   Carry-forward #8 from spike-#2 (adapter reconstruction) firms up
   under this evidence.

4. **The read-count parity between A and B.2 (3 reads each for 2
   atoms) is non-trivial.** It says: variant A's "deferred
   construction" pattern PAYS THE SAME RUNTIME COST as variant B.2
   while losing variant B's discoverability advantage. A is not
   cheaper than B.2 by any read-count metric; it is just less
   structurally explicit.

## 5. PER-CELL SCORECARD

| Cell           | (a) duplication        | (b) type-level visibility | reads (2 atoms) | rotation default        |
| -------------- | ---------------------- | ------------------------- | --------------- | ----------------------- |
| A (deferred)   | yes, relocated         | no                        | 3               | partly aware via signer |
| B.1 close-over | no (single capture)    | partial (factory visible) | 1               | stale (no re-read)      |
| B.2 re-resolve | yes, explicit          | partial (factory visible) | 3               | partly aware via signer |

**Variant A.** A.2 + A.3 expresses both sites by relocating the factory
read into iter and adding a per-call signer read. It works; it pays the
same runtime cost as B.2; it loses B's discoverability (no
`createApifySource(args, deps)` shape declaring the secret dependency).
The honest description: A is "factory-less by construction; the
factory-time read becomes 'first-iter read' as a workaround". A reader
who doesn't already know this pattern would not see the factory intent
in the code.

**Variant B sub-cell B.1.** Single resolve, both sites use the captured
string. Cleanest in terms of resolve count and code shape — but
structurally blind to rotation. If brain locks B.1 the implication is
"adapter reconstruction is mandatory on rotation", which puts the cost
on the Composer (carry-forward #8 from spike-#2). B.1's appeal is
real, but only if the kit gets adapter-reconstruction-as-Composer-
concern right.

**Variant B sub-cell B.2.** Two visibly distinct reads, one per site.
Read-count cost identical to A. Rotation safety partial (signer reads
fresh; bearer stays stale until HTTP client is rebuilt). Discoverability
intact (the factory takes `deps.secrets` and the dependency is on the
construction signature). B.2 is the most explicit shape — what you read
is what you get.

## 6. DOES THE SPIKE-#1 §7 + SPIKE-#2 §6 VERDICT FIRM UP, COLLAPSE, OR STAY MIXED?

**Firms up B, on the construction-time/run-time axis specifically.**

Spike #1 §7 leaned narrowly toward B (discoverability). Spike #2 §6 said
MIXED — A wins on default rotation safety; B wins on discoverability;
orthogonal axes. This spike adds a third axis (construction-time vs
run-time fit) where **B fits the shape natively** (the factory-time
site is real and writable) while **A has no factory site at all** and
must defer it into `iter()`. Variant A's "deferred construction" is a
workaround pattern, not a clean expression. Variant B (in either
sub-cell) lets the factory-time site live where it semantically
belongs. The spike does not resolve the rotation-safety divergence
spike #2 surfaced — that question is still open and now points at
carry-forward #7 (version-aware resolver) and #8 (adapter
reconstruction) for spike #4 leg-1 to probe.

The honest day-3 read: B is structurally the better fit for the
two-site pattern; the choice of B.1 vs B.2 collapses to a separate
question about rotation semantics that this spike intentionally did
not stress. Brain still cannot lock the ADR — but the locking question
narrows from "A vs B" to "B.1 vs B.2 vs B + version-aware-resolver".

## 7. WHAT VARIANT C WOULD DO

Spike #1 §6 prediction (verbatim recap): *"Variant C — secret needed
at construction time vs run time. This is the variant that cannot
express 'Source needs the apify-token at HTTP-client construction
time, then again per-request'. The stage resolves once and hands a
string forward. If apify needs the token during HTTP client setup AND
the adapter wants to re-mint per request from a refresh token, variant
C forces two stages
(`Secrets.fetch('apify-refresh').through(MintAccessToken).through(
apifySource)`), which is correct in spirit but pays the composition
tax for what variants A/B do internally."*

Re-entry condition for spike #4: variant C should re-enter
consideration **IF AND ONLY IF** both A and B failed (a) (duplication)
cleanly. Per §3 above:

- A failed (a) — duplication is present, just relocated into iter.
- B.1 passed (a) at the cost of rotation-blindness.
- B.2 failed (a) explicitly — two reads, two sites.

So one B sub-cell (B.1) DID pass (a), which means **the C re-entry
condition is NOT met from this spike's evidence**. Variant C does not
need to be re-implemented in spike #4.

(That said: the multi-secret pipeline stress in spike #4 leg-2 may
re-open C consideration on a *different* axis — composition tax under
multiple `.through()`s — and brain should re-read this section if leg-2
findings push that way.)

## 8. CARRY-FORWARD UPDATES

Re-listing spike #2 §7 carry-forwards (#1–8) with status updates from
this spike's evidence.

1. **Rotation semantics.** **UNCHANGED.** Not stressed in this spike.
   `invalidate(name)` remains load-bearing for the resolver interface
   (spike #2 verdict). `subscribe(name, onChange)` and TTL/version-tag
   patterns still open for spike #4 leg-1.

2. **Cache scope as ADR.** **UNCHANGED.** This spike does not introduce
   caching wrappers; the read-count parity between A and B.2 already
   shows the kit's choice on caching defaults will affect both shapes
   equivalently.

3. **SOPS / file-backed resolver ergonomics.** **UNCHANGED.** Mock-only
   spike. Stays open.

4. **Multi-secret pipelines + scoping.** **UNCHANGED.** Single-secret
   spike. Stays open for spike #4 leg-2.

5. **Construction-time secrets.** **RESOLVED partially.** This spike
   was the probe. Empirical: B has a real factory site; A has no
   factory site at all and forces "first-iter as factory" workaround.
   B is the natural fit for the construction-time/run-time pattern. The
   B.1 vs B.2 sub-question stays open and connects to carry-forward
   #7/#8.

6. **Stage-typed Secrets vs ambient ctx vs deps — kit-shape coherence.**
   **UNCHANGED.** Spike doesn't expand surface to other infra deps.

7. **Version-aware resolver default.** **REFINED.** This spike's B.1 vs
   B.2 collapse highlights the same question from a different angle: a
   version-aware resolver could let B.1 stay single-resolve at the
   read level while still serving fresh values across rotation events
   (cache + version-stamp + re-fetch on version mismatch). Spike #4
   leg-1 should probe this directly.

8. **Adapter reconstruction as a Composer concern.** **REFINED.** B.1
   makes the Composer-reconstruction question pointed: under B.1 the
   bearer site is fixed at factory time, so rotation requires either
   (a) Composer reconstructs adapters on rotation signal, or (b) the
   adapter exposes a `refreshSecrets()` API. The spike doesn't pick;
   it firms up that brain has to.

**New carry-forwards from this spike:**

9. **Async factory ergonomics.** Variant B factories now return
   `Promise<Result<Source<O>, ApifySourceError>>` because the factory
   reads a secret. The kit's adapter authoring surface needs to
   accommodate async factories cleanly — the user can't write `const
   source = createApifySource(...)` and chain `.iter(ctx)` without
   awaiting. This is a small but real ergonomic decision; it could
   propagate to other infra-dep adapters (HTTP clients, DB pools,
   config readers) that want a factory-time read. Flag for Cat I /
   Cat IV joint review.

10. **Two-site contract in adapter docs.** No variant has type-level
    machinery that says "this adapter reads X at factory time AND Y at
    run time". This is a documentation convention question. Brain may
    decide kit ships a documented "Two-Site Adapter" pattern with a
    naming convention (e.g. factory params named `*AtConstruction`,
    runtime callbacks named `*PerRequest`) — pure convention, not a
    type-system feature. Out of spike scope.

## 9. WHAT SPIKE #4 MUST STILL ANSWER

### Spike #4 leg-1 — version-aware resolver wrapper

Build a caching resolver wrapper that consults
`stats(name).current_version` on each read and drops cache entries
when the underlying version moves. Run the existing rotation harness
from spike #2 against:

- B.1 close-over (the cell that paid single-resolve cost but lost
  rotation safety) — does the version-aware wrapper close the leak
  empirically while keeping the `reads=1` ergonomic property?
- B.2 re-resolve — does the version-aware wrapper avoid the per-atom
  read inflation observed here (3 reads / 2 atoms) without losing
  rotation visibility?

Question for brain: does version-aware-by-default subsume the B.1 vs
B.2 sub-question entirely? If yes, the kit's resolver shape becomes
"single resolve per name within version, drop on version bump", and
both adapter sub-shapes converge on the same observable.

### Spike #4 leg-2 — multi-secret pipeline

Per spike #2 §8.4 plan, unchanged. Construct a pipeline where one
Source needs `apify-token` and a downstream Store needs
`supabase-service-role`. Stress naming convention vs structural scope
under variant B. Also revisit variant C briefly IF leg-2 evidence
suggests composition tax under multi-secret is itself a tractable
shape.

### C re-entry / 4th-shape probes

Per §7 above: NOT triggered. Both A and B did not fail (a) cleanly
(B.1 passed it; A and B.2 failed it but B.2 is the canonical "honest"
shape). No 4th-shape probe needed from this spike's evidence.

Spike #3's empirical contribution is bounded: it falsified the implicit
"variant A handles construction-time/run-time fine" reading by showing
A has no factory site at all, and it firmed up B as the structural
home for the two-site pattern while leaving the B.1 vs B.2 sub-question
open for spike #4 leg-1 to resolve via version-aware resolution.

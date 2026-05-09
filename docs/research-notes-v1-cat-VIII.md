# v1 Research Notes — Cat VIII: Identity / Secrets / Auth Protocols

> Phase 1 v1 synthesis. Author: Brain — 2026-05-09.
> Inputs: 6 spike FINDINGS files (`research/spikes/identity-secrets/`).
> Friction anchor: F-AUTH (catalog top-15 #2, 9/9 projects re-roll credentials).
> Status: synthesis complete; 6 ADR candidates locked direction; 5 carry-forwards.
> Modern-direction framing locked in memory `project_pipeline_kit_v1_cat_viii_synthesis_direction.md`
> (workload-identity / short-lived-tokens 2024-26 industry direction; trio + TTL + non-goals).

---

## Sources reviewed

### Spike evidence (this kit, 6 throwaway spikes — empirical truth)
- Spike #1 (`a22e91b`, 2026-05-09) — `where-does-it-live`. 3-variant placement (A: `ctx.secrets`; B: `deps.secrets`; C: `Secrets<>` stage type). Day-1 narrow lean to B on discoverability + ctx-minimalism.
- Spike #2 (`cea957e`, 2026-05-09) — `rotation-mid-run`. A vs B-CoA vs B-CoR. MIXED verdict: A and B equivalent within run; A diverges across runs (B leaks indefinitely without `invalidate()`). `resolver.invalidate(name)` elevated load-bearing.
- Spike #3 (`152a32d`, 2026-05-09) — `factory-and-runtime`. 2-site (factory + signer) harness. B has factory site; A has none. B.1 vs B.2 collapses to rotation question pointing at #7+#8.
- Spike #4 leg-1 (`c191861`, 2026-05-09) — `version-aware-resolver`. 65-LOC `createVersionAwareResolver(real)` wrapper. Full collapse on read-count + rotation-leak axes (B.1 ≡ B.2). Carry-fwd #7 RESOLVED-adopt; #8 narrowed; #11 NEW.
- Spike #5 leg-2 sub-(1) (`12bfeb1`, 2026-05-09) — `naming-vs-scope`. 2-cell + 2-stage-2-secret pipeline. Cells (e) flat + (f) scope byte-identical ledgers by composite-name forwarding. Hyphen joiner.
- Spike #6 leg-3 (`f6c0695`, 2026-05-09) — `deps-shape`. 2-cell at N=3 in apify namespace. Cells (1) flat + (3) scope byte-identical at N=3. Cell (2) flag-only structurally disqualified per spike-#2 §5/§8 + spike-#5 §3.3.

### External sources (modern industry standards 2024-26)
- AWS IRSA / GCP Workload Identity Federation / GitHub Actions OIDC — workload-identity direction; short-lived STS tokens.
- SPIFFE / SPIRE — k8s-native workload identity primitives.
- Doppler / Infisical — developer secret-management SaaS; long-lived API keys today, OIDC roadmap.
- SOPS + age + KMS — encrypted-in-git pattern; self-hosted GitOps direction.
- HashiCorp Vault — dynamic secrets + lease semantics; reference for `invalidate()` shape.
- 1Password CLI / op — local-developer secret backend; envelopable behind `SecretsResolver`.
- OAuth 2.1 + DPoP — token binding patterns; orthogonal to resolver contract.
- v0 ADR17 — HMAC-SHA256 webhook signing (`docs/spec.md` line 1017); Q5 must NOT amend.

---

## Spike #1 — where-does-it-live (placement)

3-variant TS spike resolving `apify-token` from a shared mock resolver. **A:** `ctx.secrets.resolve(...)` inside `Source.iter(ctx)`. **B:** `createApifySource({ deps: { secrets } })`. **C:** `Secrets.fetch('apify-token').through(apifySource)` — secret as input atom; new `Process<string, ApifyJobItem, never>` stage type.

What it revealed:
1. **Variant A** — adds `secrets` to `PipelineContext`; ambient-dep god-object risk. No type-level signal.
2. **Variant B** — `PipelineContext` stays minimal. Construction site documents the secret dep; omission = compile error.
3. **Variant C** — cleanest blame attribution; new primitive (5th stage type); composition tax for multi-secret; cannot express construction-time-vs-run-time.
4. **A and B near-identical at iterator call site.** Difference is ambient (A) vs declared (B); not structural.
5. **Cross-variant break — secret namespacing across multiple Sources.** None of A/B/C offers structural help.
6. **Verdict.** Day-1 narrow lean to B; spike-2 verifies under rotation; C re-entry condition: A and B both fail (a) duplication cleanly.

```ts
const apifySource = createApifySource({
  args: { actorId: 'apify/web-scraper' },
  deps: { secrets },          // omission = compile error; greppable contract
});
```

---

## Spike #2 — rotation-mid-run

A vs B-CoA (cache-on-adapter) vs B-CoR (cache-on-resolver). Mock resolver gains `invalidate(name)` (bumps version + rotates value) and `stats(name)` (`{reads, current_version}`). Two runs in one process; mid-run-#1 `invalidate()`.

What it revealed:
1. **Within-run staleness** — A, B-CoA, B-CoR all serve stale after rotation (cache scope doesn't matter within a run).
2. **Across-run divergence** — A's fresh ctx forces fresh fetch (`reads=2`, sees `apify-tok-v1-rotated-v2`). B reused-adapter (both sub-cases) keeps serving pre-rotation token indefinitely (`reads=1` forever). **Leak unbounded by default in B.**
3. **`resolver.invalidate(name)` is load-bearing.** Without it kit has no rotation vocabulary at all.
4. **Three remediation paths** for B's leak: (1) rebuild adapter per run (Composer concern); (2) push-`subscribe(name, onChange)` (new API surface); (3) pull-via-`stats(name).current_version` per read (version-aware resolver).
5. **Verdict.** MIXED — falsifies "B is fine" simple read on rotation axis; B's discoverability advantage intact. Resolver MUST expose `invalidate(name)`. Path (3) = spike-#4 leg-1 probe.

```ts
// Same adapter, two runs. Real underlying rotated to v2 between runs.
// B-CoA + B-CoR both observe: run2.atom1 token_seen="apify-tok-v1" (STALE LEAK)
// Variant A:                  run2.atom1 token_seen="apify-tok-v1-rotated-v2" (FRESH)
```

---

## Spike #3 — factory-and-runtime

Three observable cells over an Apify-shaped HTTP-client mock that needs the same secret at TWO sites — once at HTTP-client construction (factory), once per request (signer). **A:** `ctx.secrets`, deferred construction. **B.1:** close-over (factory resolves once; signer captures string). **B.2:** re-resolve at run-time.

What it revealed:
1. **Variant A literally has no factory site** — `createApifySource(args)` has no ctx; "factory resolve" is implicit "first-iter resolve" workaround. Read-count parity with B.2 (3 reads / 2 atoms) but no declared factory.
2. **Variant B has a real factory site** — `createApifySource(args, { secrets })` — both `args` and `secrets` in scope. Factory becomes async (`Promise<Result<Source<O>, E>>`); real ergonomic change but not a deal-breaker.
3. **B.1 vs B.2 collapses to rotation question** — B.1 (single resolve, rotation-blind) vs B.2 (visible duplication, partial rotation-aware). Question points at carry-fwd #7 + #8.
4. **C re-entry NOT triggered** — B.1 passed (a) duplication cleanly.
5. **Verdict.** Firms B on construction-time/run-time axis. Locking question narrows from "A vs B" to "B.1 vs B.2 vs B + version-aware-resolver" — spike #4 leg-1 probes.

```ts
const tokenResult = await secrets.resolve('apify-token');   // factory site
// ...
signRequest: async (atomId) => {
  const live = await secrets.resolve('apify-token');         // run-time site (visible)
  return ok(mintCallId(live, atomId));
};
```

---

## Spike #4 leg-1 — version-aware-resolver

`createVersionAwareResolver(real)` (65 LOC) — pull-only caching wrapper. On `resolve(name)`: probe `real.stats(name).current_version`; cache hit on `{value, version}` match → return cached; else `real.resolve(name)`, stamp into cache. `invalidate`/`stats` pass-through. **2×2 matrix:** {B.1 close-over | B.2 re-resolve} × {two-site harness | rotation harness}.

What it revealed:
1. **Two-site reads collapse to 1.** Spike-#3 B.2 was 3 reads / 2 atoms; under wrapper, cells (a) and (b) both end at `final reads=1`.
2. **Cross-run rotation leak closes in both adapter shapes.** Spike-#2 B-CoA/B-CoR both leaked; cells (c) and (d) both serve `apify-tok-v1-rotated-v2` after the version bump (cost: +1 read at version-bump only).
3. **Full collapse on observables this spike measured** — B.1 ≡ B.2 byte-identical traces. Adapter shape stops mattering once the wrapper owns caching.
4. **Two unprobed dimensions could still split B.1 vs B.2:** (i) long-lived non-re-readable resources (HTTP/2 connection / pre-signed URL); (ii) sync API surfaces.
5. **NEW carry-fwd #11** — wrapper composition with TTL / push-rotation layers. `createTtlResolver(createVersionAwareResolver(real), ttlMs)` is a natural composition.
6. **Verdict.** Carry-fwd #7 RESOLVED-adopt. Carry-fwd #8 scope SHRINKS to non-re-readable resources only. Ship version-aware-resolver as kit default; adapters call `resolve(name)` freely.

```ts
async resolve(name) {
  const v = real.stats(name).current_version;
  const hit = cache.get(name);
  if (hit && hit.version === v) return ok(hit.value);
  const r = await real.resolve(name);
  if (r.error === null) cache.set(name, { value: r.data, version: v });
  return r;
}
```

---

## Spike #5 leg-2 sub-(1) — naming-vs-scope

2-cell spike under `B + version-aware-resolver` extended with `scope(prefix)` sub-view (114 LOC; +49 LOC `scope()` extension). **Cell (e) flat:** `secrets.resolve('apify-token')` + `secrets.resolve('supabase-service-role')`. **Cell (f) scope:** `secrets.scope('apify').resolve('token')` + `secrets.scope('supabase').resolve('service-role')`. Two-stage Source(apify) → Store(supabase) pipeline; 2 atoms. Composite-name joiner = hyphen (matches kit `NAME_RE` `^[a-z0-9][a-z0-9-]*$`).

What it revealed:
1. **Read-count ledger byte-identical** between (e) and (f). Composite-name forwarding (`${prefix}-${suffix}`) lands on the same parent cache entries.
2. **Type-level discoverability partially gained** — `scope('apify')` gives a type-pinned `ScopedSecretsResolver` at the bind site; suffix strings (`'token'`) remain string literals.
3. **Composition tax small but nonzero** — cell (f) costs +1 import (`ScopedSecretsResolver`) + 1 binding + 1 closure-cache question.
4. **Sub-view shares parent cache by design** — no per-scope cache forking. Locked design choice.
5. **NEW carry-fwd #12** — composite-name joiner choice (hyphen vs dotted). Hyphen locked at this leg.
6. **Verdict.** Q4 single-secret axis: flat hyphenated naming sufficient as default; `scope()` provides marginal discoverability gain at single-secret scale. Defers deps-shape question to leg-3.

```ts
// scope('apify').resolve('token') → parent.resolve('apify-token')
// Same cache entry. Same read count. By construction.
```

---

## Spike #6 leg-3 — deps-shape

2-cell spike at N=3 in apify namespace. Source(apify) factory consuming 3 secrets (`apify-token` / `apify-actor-id` / `apify-webhook-secret`). **Cell (1) flat:** `deps: { secrets: SecretsResolver }`; multi-resolve. **Cell (3) scope:** `deps: { apifySecrets: ScopedSecretsResolver }`; driver pre-binds `wrapped.scope('apify')` at DI boundary. 2 atoms; per-name reads observed. **Cell (2) flag-only** (dep-per-secret pre-resolved at construction) NOT built — structurally disqualified per spike-#2 §5/§8 + spike-#5 §3.3.

What it revealed:
1. **Read-count ledger byte-identical at N=3.** All 3 names: `reads=1` per version under both deps shapes. Wrapper's per-name cache absorbs every repeat read across factory + per-request signer.
2. **Type-level discoverability gain at N=3 is real but bounded.** Cell (3) pins namespace at deps signature + dedups `apify-` prefix from 3 literals to 1 scope-bind. Suffixes still strings.
3. **Composition tax amortises better at N=3 than N=1** — paid once per adapter, regardless of N.
4. **Cell (2) structural disqualification.** Pre-resolved deps frozen at boot; rotation goes unobserved indefinitely; cannot participate in version-aware wrapper's stats-probe machinery (values already read at construction).
5. **Verdict.** Q4 deps-shape axis: default flat (`{ secrets: SecretsResolver }`); scope optional façade for namespace-heavy adapters at N≥3. carry-fwd #4 RESOLVED across all three Q4 axes.

```ts
const wrapped = createVersionAwareResolver(real);
const apifySecrets = wrapped.scope('apify');           // 1 line at DI boundary
const apifySource = await createApifySource({ args, deps: { apifySecrets } });
```

---

## Modern-direction framing (2024-26 industry context)

Direction of travel in secrets management is **away from "fetch a long-lived secret and rotate it" → toward "workload identity exchanges short-lived tokens"** (AWS IRSA / GCP Workload Identity Federation / GitHub Actions OIDC; SPIFFE / SPIRE in k8s-heavy shops). Legacy direction (long-lived API keys, manual rotation) still dominates kit's actual constellation use cases — Anthropic, OpenAI, Apify, Supabase all issue long-lived keys — but kit MUST be backend-neutral by design so the same adapter code rides both directions.

**Good news for kit's leg-1→3 architecture:** `B + version-aware-resolver` is already the right abstraction. Its `(name) → Promise<Result<string, SecretsError>>` contract is consulted per-resolve via `stats(name).current_version`. An OIDC-token-exchange resolver implements that shape transparently — the adapter does not know whether the returned string is a 60-day Apify token or a 5-minute STS token. Spikes #1-#6 generalise forward unchanged.

**TTL wrapper as load-bearing piece for short-lived tokens.** Workload identity invalidates by `exp`; the TTL wrapper is the polling cadence that surfaces token expiry to the kit's `stats(name)` mechanism. See ADR-v1-VIII-3.

**Reference-adapter trio (not one) at v1 ship.** Three references prove the contract spans the spectrum from `.env` → encrypted-in-git → workload-identity. See ADR-v1-VIII-5.

---

## Open questions answered (5 outline questions)

### Q1 — `SecretsAdapter` placement (Context concern / adapter dependency / stage type)?
**Adapter dependency (variant B).** Spike #1 + spike #3: A and B near-identical at iterator call site BUT B has a real factory site (A doesn't); A's "deferred construction" is a workaround. C is a 5th-stage-type kit-shape decision and pays composition tax for multi-secret. `PipelineContext` stays minimal. See ADR-v1-VIII-1.

### Q2 — Right scoping unit (pipeline / atom / adapter / per-call)?
**Per-call resolve, cache lives on resolver wrapper instance.** Adapter calls `secrets.resolve(name)` at every site that needs the secret; the version-aware wrapper collapses repeat reads to 1 per name per version. Adapter-level caches become unnecessary. `scope()` sub-views share the parent cache by composite-name forwarding (no per-scope cache forking). See ADR-v1-VIII-2 + ADR-v1-VIII-4.

### Q3 — Rotation semantics kit guarantees (pre / mid / post-rotation)?
**`invalidate(name)` is load-bearing on the resolver interface; `stats(name).current_version` is the rotation-detection mechanism.** Pull-via-stats version-stamp cache-drop closes both within-run staleness and cross-run leaks (spike #4 leg-1 empirically). Push-`subscribe(name, onChange)` and TTL are composable wrappers, NOT primary mechanism. **Kit guarantees:** post-`invalidate(name)` + at-least-one-stats-probe = next-resolve sees fresh value (re-readable secrets); long-lived non-re-readable resources → carry-fwd #8 narrow scope. See ADR-v1-VIII-2.

### Q4 — Scoping + naming + deps shape?
**Default flat hyphenated names** (`apify-token`); **default deps shape `{ secrets: SecretsResolver }`** (multi-resolve from one resolver). `scope(prefix)` + `{ <ns>Secrets: ScopedSecretsResolver }` are **OPTIONAL façades** for namespace-heavy adapters at N≥3. Hyphen joiner matches existing kit `NAME_RE`. Both shapes byte-identical runtime observables (spike #5 + spike #6). Cell (2) structurally disqualified. See ADR-v1-VIII-4.

### Q5 — Does kit ship a concrete adapter, or only a contract? + HMAC envelope auth?
**Kit ships BOTH the contract (`SecretsResolver` + `createVersionAwareResolver` + `createTtlResolver`) AND a 3-reference-adapter trio at M2: `@pipeline-kit/secrets-env` + `-sops` + `-oidc`.** Three references prove the contract spans long-lived API keys → encrypted-in-git → short-lived workload-identity tokens. **HMAC envelope auth stays at v0 ADR17 webhook scope, NOT extended via `SecretsAdapter` coupling** — orthogonal concerns. See ADR-v1-VIII-5.

---

## Open questions unresolved (carry-forwards)

1. **Real-backend ergonomics** (carry-fwd #3, UNRESOLVED). All 6 spikes mock-only. SOPS / age / 1Password / Vault / AWS SM / GCP SM / OIDC backend ergonomics need verification at M2 against the trio.
2. **Adapter reconstruction for non-re-readable resources** (carry-fwd #8 narrow scope, OPEN). Long-lived HTTP/2 streams, pre-signed URLs, handshake-time credentials — wrapper closes the leak for re-readable string secrets but cannot rebuild stateful resources whose lifetime exceeds the secret's validity. Composer-level concern; cross-cuts Cat I (durable) + Cat VI (stage model). Carry to Cat VI synthesis or M2 spike.
3. **Push-`subscribe(name, onChange)` evaluation** (carry-fwd from Q3, OPEN). Pull-via-stats is kit default; push-rotation is composable wrapper for OIDC backends but not yet probed. M2 micro-spike if friction surfaces.
4. **Composite-name joiner edge cases** (carry-fwd #12, UNCHANGED). Hyphen joiner locked; dotted-name `apify.token` would require `NAME_RE` extension. Carry to v1.x if adopter pressure.
5. **PII / secret redaction empirical probe** (NEW from synthesis, see ADR-v1-VIII-6). Cat VIII spikes did not exercise observability redaction; ADR-v1-VIII-6 ships direction-only and flags M2 micro-spike to validate Zod-annotation-driven OTel redaction.

---

## ADR candidates

### ADR-v1-VIII-1 — `SecretsAdapter` placement: adapter dependency (variant B)

**Status:** v1 candidate (synthesis 2026-05-09). Awaiting brain v1 spec lock.

**Context:** v0 punted on identity/secrets (catalog top-15 #2; 9/9 projects re-roll credentials). Spikes #1 + #3 probed three placement variants. A and B are structurally near-identical at the iterator call site (spike #1); B has a real factory site, A literally has no factory site (spike #3); C is a 5th-stage-type kit-shape decision with composition tax for multi-secret.

**Decision:** `SecretsResolver` is **passed as an adapter dependency** at construction site. Adapter factories take `deps: { secrets: SecretsResolver }` (or scoped variant per ADR-v1-VIII-4) and store the reference for later `resolve(name)` calls. `PipelineContext` does NOT carry `secrets` — stays minimal (run_id / signal / trace / idempotencyKey). Adapter factories that need secrets at construction time become async (`Promise<Result<Source<O>, E>>`).

**Alternatives considered:**
- *Variant A — `ctx.secrets`.* Rejected. Ambient-dep pattern grows into ctx-as-god-object; no type-level signal of which adapter uses which secret.
- *Variant C — typed `Secrets<>` stage.* Rejected. Adds 5th stage type — kit-shape decision should not be made on secrets-only grounds; composition tax for multi-secret; cannot express construction-time-vs-run-time without forcing two stages.
- *Hybrid (ctx for some, deps for others).* Rejected — inconsistency invites the same god-object failure mode.

**Reference:** spike-#1 §7 + §8; spike-#3 §4 + §6.

**Consequences:**
- Construction site documents the secret dependency (omission is a hard compile error).
- `PipelineContext` shape unchanged from v0 — no v0 amendment needed.
- Async factory ergonomics propagate (carry-fwd #9) — `await create<X>Source({ args, deps })`.
- Adapter authors discover one resolver pattern at the construction-site contract; greppable by `deps: { secrets`.
- M2 reference adapters (env / sops / oidc per ADR-v1-VIII-5) all use the deps-shape uniformly.

### ADR-v1-VIII-2 — Rotation semantics: `invalidate(name)` + version-aware resolver default

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #2 surfaced that variant B leaks pre-rotation tokens indefinitely across runs without explicit invalidation. Spike #4 leg-1 probed a 65-LOC version-aware caching wrapper that pull-via-stats checks `current_version` on every `resolve()` and drops cache on version mismatch. Empirically: closes both within-run staleness and cross-run leaks; collapses B.1 vs B.2 to byte-identical traces.

**Decision:** The `SecretsResolver` interface is:
```ts
interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
  invalidate(name: string): void;
  stats(name: string): { reads: number; current_version: string };
}
```
Kit ships **`createVersionAwareResolver(real: SecretsResolver): SecretsResolver`** as the default wrapper. Adapters call `resolve(name)` freely; cost = one `stats()` sync probe per call + one underlying read per name per version. **Cache lives on the wrapper instance** (typically constructed once per process or pipeline at the DI boundary).

**Alternatives considered:**
- *Per-adapter caching (B-CoA).* Rejected — leaks indefinitely across runs (spike #2 §6).
- *Push-`subscribe(name, onChange)` from resolver.* Rejected as primary — adds API surface; composes poorly multi-process. May ship as optional wrapper in v1.x if OIDC backends pressure.
- *Force per-run adapter reconstruction (Composer-level).* Rejected as primary — pays construction cost per run; warm-up state lost. Carry-fwd #8 narrow scope retains for non-re-readable resources only.
- *No invalidation primitive.* Rejected — kit has no rotation vocabulary at all without `invalidate(name)`.

**Reference:** spike-#2 §3 + §6 + §7; spike-#4 leg-1 §3 + §6 + §7.

**Consequences:**
- Adapters do NOT manage caching themselves — kit's wrapper owns the cache.
- Re-readable string secrets are rotation-safe by default; non-re-readable resources → carry-fwd #8 narrow scope.
- `SecretsError` envelope: forwarded unchanged (no caching of errors).
- Concurrent `resolve(name)`: single-threaded JS event-loop assumption; thundering-herd protection NOT shipped (carry to M2 if multi-runtime).
- Adapter authors do NOT need to know whether secret is 60-day API key or 5-minute STS token.

### ADR-v1-VIII-3 — TTL composition wrapper for short-lived-token backends

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Workload identity (AWS IRSA, GCP WIF, GitHub OIDC) issues short-lived tokens (5-60 min) that invalidate by `exp` claim, not by upstream `invalidate(name)` call. Version-aware-resolver pulls on `stats(name).current_version` per call; without a TTL nudge, the wrapper has no signal to re-fetch a token about to expire silently. Carry-fwd #11 from spike #4 leg-1.

**Decision:** Kit ships **`createTtlResolver(inner: SecretsResolver, ttlMs: number): SecretsResolver`** as a second composable wrapper. On `resolve(name)`: track per-name last-fetch timestamp; if `now - lastFetch >= ttlMs`, call `inner.invalidate(name)` (which bumps the underlying version, triggering version-aware-resolver's cache-drop on the same call). Composes naturally: `createTtlResolver(createVersionAwareResolver(real), 60_000)`.

**Alternatives considered:**
- *Bake TTL into version-aware-resolver as a parameter.* Rejected — single-responsibility violation; couples version-detection vs time-based expiry.
- *Push-`subscribe` from OIDC backends.* Rejected as primary — not all OIDC providers expose subscription; STS API is poll-by-design.
- *Punt to v2.* Rejected — workload-identity is the 2024-26 industry direction; shipping v1 without TTL tells adopters kit is legacy-only.
- *User-glue layer (no kit primitive).* Rejected — every adopter would re-implement; wrapper is small (~50 LOC est.) and composes existing primitives.

**Reference:** spike-#4 leg-1 §7 carry-fwd #11; modern-direction framing memory; AWS STS / GCP WIF / GitHub OIDC SDK docs.

**Consequences:**
- Composable wrapper stack: `createTtlResolver(createVersionAwareResolver(real), ttlMs)`. Order matters — TTL outside, version-aware inside.
- Per-name TTL granularity (not global) — adapter-author can compose per-secret if needed.
- TTL micro-spike deferred to M2 alongside `secrets-oidc` reference adapter; ADR direction defensible from version-aware-resolver evidence + modern-direction framing.
- Adapter authors do NOT couple to TTL — wrapper invisible at adapter call site.
- `scope()` composition: TTL outer surface still exposes `SecretsResolver`; `scope()` lives on the version-aware wrapper underneath. Document in M2 reference-adapter README.

### ADR-v1-VIII-4 — Naming + scoping + deps shape: flat default, `scope()` optional façade

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spikes #5 + #6 probed three Q4 sub-axes (runtime / discoverability / deps-shape) under `B + version-aware-resolver`. Cells (e) flat + (f) scope (spike #5) and cells (1) flat + (3) scope (spike #6 at N=3) produced byte-identical read-count + closed-over-value ledgers under both shapes. Cell (2) (dep-per-secret pre-resolved) NOT built — structurally disqualified per spike-#2 §5/§8 + spike-#5 §3.3.

**Decision:** Three layered defaults:
1. **Naming default — flat hyphenated names** (`apify-token`, `supabase-service-role`). Matches existing kit `NAME_RE` `^[a-z0-9][a-z0-9-]*$`. Hyphen joiner.
2. **Deps default — `{ secrets: SecretsResolver }`** (single resolver, multi-resolve at adapter call sites).
3. **Scoped façade — OPTIONAL.** `secrets.scope(prefix)` returns a `ScopedSecretsResolver` whose `resolve(name)` forwards to parent with composite name `${prefix}-${name}`. Sub-view shares parent cache by design (no per-scope cache forking). Adapters consuming N≥3 secrets from one namespace MAY accept `{ <ns>Secrets: ScopedSecretsResolver }` instead, with the driver constructing the scope at the DI boundary (`wrapped.scope('<ns>')`).

Both deps shapes produce byte-identical runtime observables; choice is adapter-author style for namespace-heavy adapters, not a kit contract.

**Alternatives considered:**
- *Dotted-name regex extension (`apify.token`).* Rejected at v1 — would require `NAME_RE` change + joiner-config across all backends. Carry-fwd #12 to v1.x.
- *Mandate scope() everywhere.* Rejected — composition tax not justified at single-secret-per-adapter scale (spike #5 verdict).
- *Cell (2) — dep-per-secret pre-resolved.* Structurally disqualified — boot-time leak posture; cannot participate in version-aware wrapper's stats-probe machinery.
- *Per-scope cache forking.* Rejected — every scope() call would multiply cache state; sub-view sharing parent cache is the simpler invariant.

**Reference:** spike-#5 §4 + §6; spike-#6 §4 + §5 + §7; spike-#2 §5/§8 (cell (2) disqualification anchor).

**Consequences:**
- Adapter authors default to `secrets.resolve('apify-token')` — one line, greppable, type-checked.
- Namespace-heavy adapters (N≥3) MAY adopt `apifySecrets.resolve('token')` with one driver-side scope-bind line.
- `scope().scope()` recursive composition supported (additive prefixes); not exercised in spikes; documented.
- Async `scope()` not supported (wrapper interface is sync); flag if SOPS-namespace-lazy-loading ever surfaces.
- Joiner choice (hyphen) locked at v1; revisit only if `NAME_RE` extension lands.

### ADR-v1-VIII-5 — Reference-adapter trio + non-goals: env / sops / oidc; kit is NOT a vault

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** v1 outline §Cat VIII Q5 asks "does kit ship a concrete adapter, or only a contract?" Phase 0 catalog evidence (F-AUTH 9/9 projects) shows real adopters span the spectrum from `.env` files (every project today) to encrypted-in-git (devshield, gatewerk SDK secrets) to workload-identity (the 2024-26 direction). Modern-direction framing memory locks the trio decision over a single-reference shipment.

**Decision:** Kit ships at v1 / M2:
- **Contract:** `SecretsResolver` interface + `createVersionAwareResolver` + `createTtlResolver` + `scope()` façade (per ADRs VIII-1 → VIII-4).
- **Reference-adapter trio (M2 packs under `@pipeline-kit/secrets`):**
  - `@pipeline-kit/secrets-env` — env-var resolver. Default for laptop + VPS (matches every constellation project today).
  - `@pipeline-kit/secrets-sops` — SOPS + age / KMS encrypted-in-git. Self-hosted GitOps direction.
  - `@pipeline-kit/secrets-oidc` — OIDC token exchange. Modern direction (AWS IRSA / GCP WIF / GitHub Actions OIDC).

**Non-goals (explicit rejections — do NOT ship):**
- Kit is NOT a secret store — lean on Doppler / Infisical / 1Password / Vault / cloud SMs at user-glue tier.
- Kit ships NO encryption primitives — lean on SOPS / age / KMS / Tink at the resolver implementation tier.
- HMAC envelope auth is a SEPARATE concern from secrets resolution; couple at the Serve-adapter boundary (v0 ADR17 + spec-adapters §15 webhook-serve), NOT at `SecretsResolver` contract.
- Secret detection / scanning is devshield's territory (per Phase 0 catalog), not kit's.
- Multi-tenant identity / RBAC is downstream-app territory (per packs §6 rejection list), not kit's.

**Alternatives considered:**
- *Ship one reference adapter (env-var only); layer sops + oidc later.* Rejected — invites "is this kit modern?" pushback; trio framing locked at synthesis per modern-direction memory; user authorised 2026-05-09.
- *Ship contract only, no reference adapters.* Rejected — F-AUTH 9/9 ubiquity demands a runnable starting point.
- *Ship vault-like primitive in kit.* Rejected per non-goals — kit stays library-tier.
- *Couple HMAC envelope auth into `SecretsResolver`.* Rejected — orthogonal concerns; v0 ADR17 locked + sufficient.

**Reference:** modern-direction framing memory; Phase 0 friction catalog (F-AUTH 9/9); v0 ADR17 (HMAC webhook signing); v0 spec-adapters §15 (webhook-serve); packs §6 rejection list.

**Consequences:**
- M2 LOC budget impact: ~600-900 LOC for the trio vs ~250 LOC for env-only. User accepted at spike-6 close-out.
- All three reference adapters expose the same `SecretsResolver` shape; user can mix via wrapper composition.
- v0 `pk.webhooks.verify(rawBody, sigHeader, secret)` API surface unchanged — `secret` stays a raw string at the API boundary; user MAY source it from a `SecretsResolver` at user-glue tier but kit makes no contract.
- Pack roster (`-packs.md` §2 launch tier `@pipeline-kit/secrets`) updated to enumerate the trio.
- Future v1.x: `@pipeline-kit/secrets-doppler` / `-infisical` / `-vault` welcomed as ecosystem additions; not v1.0 scope.

### ADR-v1-VIII-6 — PII / secret redaction in observability: default-on at Zod boundary

**Status:** v1 candidate (direction-only; M2 micro-spike flagged). Awaiting brain v1 spec lock.

**Context:** Packs §5.3 names PII / secret redaction as a Cat VIII v1 must-have: atoms flowing through stages carry user data, secrets, API responses, and kit's observability traces leak them silently to Langfuse / Helicone / OTel collectors by default. The 6 Cat VIII spikes did NOT exercise observability redaction; ADR direction is defensible from packs §5.3 evidence + v1 must-have status, but empirical validation is M2 work.

**Decision:** Kit ships **default-on schema-annotation-driven redaction** at the Zod boundary:
```ts
const Atom = z.object({
  user_email: z.string().email().describe('@redact'),
  prompt:     z.string(),
  api_key:    z.string().describe('@secret'),
});
```
- `@redact` annotation: field value replaced with `<redacted:N-chars>` in OTel span attrs + `@pipeline-kit/observe` adapter outputs.
- `@secret` annotation: field value replaced with `<secret:hash-prefix>` (first 8 chars of SHA-256 hex of value); enables debugging "did the secret value change?" without leaking it.
- Default-on; explicit opt-out via `pipeline.observe({ redaction: 'off' })` (discouraged; loud warning).
- Hooks at the Zod boundary (Source ingest + Serve emit); NOT coupled to `SecretsResolver` contract — orthogonal concern.

**Alternatives considered:**
- *Redaction off-by-default with opt-in.* Rejected — leak-by-default is unforgivable for personal automations carrying real data (packs §5.3 stance).
- *Couple redaction to `SecretsResolver` (auto-redact every value returned by `resolve()`).* Rejected — `resolve()` returns strings to the adapter; redaction must happen at the observability boundary, not the resolution boundary.
- *Redaction as separate pack `@pipeline-kit/redact`.* Rejected — must be default-on in core to avoid leak-by-default.
- *Use `z.string().brand('Secret')` instead of `.describe('@redact')`.* Considered; deferred — branded types lose the semantic tag at runtime serialisation; description annotation survives JSON Schema bridge (per Cat IX ADR-v1-IX-2).

**Reference:** packs §5.3; Cat IX ADR-v1-IX-2 (Zod → JSON Schema bridge — annotations survive); v0 spec §1 boundary discipline.

**Consequences:**
- Atom schemas grow `.describe('@redact')` / `@secret` annotations at sensitive fields.
- `@pipeline-kit/observe` (launch-tier pack) consumes annotations to filter span attrs before export.
- M2 micro-spike required: validate Zod-annotation propagation through `zod-to-json-schema` (Cat IX ADR-v1-IX-2 codegen) → Pydantic `Field(..., description=...)` round-trip → cross-runtime adapters honour annotations.
- v0 ADR amendment risk: NONE — v0 spec §1 sets Zod boundaries but does not specify span-attr extraction.
- Concrete unresolved: brand-vs-describe choice (deferred to v1 spec lock); secret-hash algorithm + truncation length (defer to M2).
- This ADR is the SOFTEST of the six (no spike evidence for redaction mechanism specifically); brain may demote to carry-forward + dedicated spike if M2 micro-spike surfaces friction.

---

*End of v1 Cat VIII research notes. 6 ADR candidates locked direction; 5 carry-forwards. Modern-direction framing (workload-identity / short-lived-tokens 2024-26) lifted into ADRs VIII-3 + VIII-5. Q1-Q5 outline questions answered + a Q6-equivalent (redaction) raised from packs §5.3. Next-next-session candidate: Cat V spike #1 (orchestr8 wiring as MemoryAdapter ref impl); idle-buffer session acceptable per anchoring discipline.*

*Author: Brain — 2026-05-09. Inputs: spike #1 `a22e91b` / spike #2 `cea957e` / spike #3 `152a32d` / spike #4 leg-1 `c191861` / spike #5 leg-2 sub-(1) `12bfeb1` / spike #6 leg-3 `f6c0695`. Branch: `v1-cat-VIII-synthesis-notes`. Master tip at synthesis: `643e281`.*

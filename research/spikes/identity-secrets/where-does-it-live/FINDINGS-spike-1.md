# Cat VIII Spike #1 — `where-does-it-live` Findings

> Spike: three structural placements for `SecretsAdapter` over a shared
> Apify-Source-shaped mock.
> Branch: `v1-cat-VIII-spike-1`. Author: Executor — 2026-05-09.
> Companion to: `docs/research-outline-v1.md` § Category VIII (Identity / Secrets).
> Status: spike output (NOT a notes file; brain synthesises a notes-v1-cat-VIII.md later).
> Friction anchor: `F-AUTH` — top-15 #2, 9/9 universality.

## 1. WHAT WAS BUILT

A 3-variant TS spike, each variant resolving the `apify-token` from the
**same** in-memory mock resolver, then "calling Apify" (just `console.log`)
and emitting one `Atom<ApifyJobItem>` Result. The shared fixture
(`mock-secrets-resolver.ts`) registers two secrets — `apify-token` and
`supabase-service-role` — exposes a `resolve(name) → Promise<Result<string,
SecretsError>>` shape, validates name against a kit-shape regex
(`/^[a-z0-9][a-z0-9-]*$/`), and surfaces two error codes: `secret_not_found`
and `malformed_name`.

- **Variant A — Context concern.** `ctx.secrets.resolve(...)` inside
  `Source.iter(ctx)`. `PipelineContext` carries `secrets` alongside
  `run_id` and `signal`.
- **Variant B — Adapter dependency.** `createApifySource({ deps: { secrets }
  })`. `PipelineContext` no longer knows about secrets.
- **Variant C — Stage type.** `Secrets.fetch('apify-token').through(
  apifySource)`. `apifySource` becomes `Process<string, ApifyJobItem,
  never>` — secret arrives as **input** rather than being resolved
  internally.

Run output (full trace in `run-spike-1.sh`):

```
[variant-a] OK atom pk_atom_VARIANT_A_01 title="Senior Backend Engineer"
[variant-b] OK atom pk_atom_VARIANT_B_01 title="Senior Backend Engineer"
[variant-c] OK atom pk_atom_VARIANT_C_01 title="Senior Backend Engineer"
```

Smoke-test of resolver error branches: both `secret_not_found` and
`malformed_name` surface with the kit-shape `{type, code, message, param}`
envelope. All three variants return early with `process.exitCode = 1` on
`result.error !== null`.

## 2. TYPE ERGONOMICS

### Variant A (Context concern)

`Source<O>` keeps a single generic `O` for the atom payload — clean. The
cost lands on `PipelineContext`: it now carries `secrets: SecretsResolver`
in **every** stage that reads ctx, even those that touch no secrets. TS
gave zero help noticing that `apifySource` actually *needs* `ctx.secrets`
— a Source that forgot to declare its secret usage at the type level would
still type-check. The error type (`SecretsError`) leaks into the Source's
output Result type — `AsyncGenerator<Result<Atom<O>, SecretsError>>` —
because every Source can in principle hit a secrets failure. Realistically
the kit will widen this to a union (`SourceError | SecretsError | ...`) and
TS will track it, but at small scale the leak is visible.

**Felt natural:** ctx is already there; one more attribute is cheap.
**Felt awkward:** secrets is now a hidden ambient dependency for every
adapter. No type-level signal of "this Source uses these secret names".

### Variant B (Adapter dependency)

`createApifySource(deps)` makes the dependency explicit at the
construction site, and `ApifySourceDeps` is reusable as a type alias.
`Source<O>` itself stays unchanged. `PipelineContext` shrinks back to pure
run-scope (run_id, signal, trace, idempotencyKey). The error type still
leaks the same way as variant A — the Source still resolves and surfaces
`SecretsError`. TS does help here in one specific way: omitting `secrets`
in the `deps` object at construction is a hard compile error. The
construction site documents what the adapter needs.

**Felt natural:** explicit deps + unchanged Source/Context.
**Felt awkward:** secrets resolution still happens inside `iter()`, so the
Source code path mirrors variant A almost line-for-line — the only thing
that moved is *who hands you the resolver*. Day-1 evidence: variant B is a
strict refactor of variant A, not a structurally different shape.

### Variant C (Stage type)

The most aggressive refactor. `apifySource` becomes
`Process<string, ApifyJobItem, never>` — the secret is just an input atom
(string). Secrets resolution lives in a brand-new `SecretsStage` type
whose error union (`E | SecretsError`) widens the downstream stage's error
type structurally. TS *did* help here: dropping `Secrets.fetch(...)
.through(...)` against a Process whose input wasn't `string` was a
compile error during prototyping. Generic propagation through `through<O,
E>` worked, but the surface area exploded — `SecretsStage`,
`Process<I, O, E>` with three generics, plus the `.through()` builder.
Composing two secrets (e.g. `apify-token` + `apify-userid`) requires
either currying through multiple `.through()`s or extending the stage to
return a tuple — neither feels natural at this size. **Naturalness vs
explicitness trade is steepest here.**

**Felt natural:** secret-as-input cleanly separates resolution from
consumption; the Source becomes pure-ish.
**Felt awkward:** new stage primitive; Source signature now lies about
the world (it pretends an Apify call needs only a token, ignoring HTTP
client, retry policy, etc., which a real Source has). Implies *every*
infra dependency wants the same treatment, which is a kit-shape decision,
not a secret-specific one.

## 3. ERROR SURFACE

All three variants surface `SecretsError` via the existing `Result<T, E>`
shape — no thrown errors, no ctx.signal abort. Where they differ is *what
generic param the error rides on*:

- **Variant A.** `Source<O>.iter(ctx)` yields `Result<Atom<O>,
  SecretsError>` — error is a stage-level value emitted from the iterator.
  Composer must decide whether one bad secret aborts the run or just
  drops the atom. The Source has no way to signal "this is fatal vs
  retryable" beyond the error code.
- **Variant B.** Identical to A at the iterator level — the error rides
  the same Result. The structural difference (deps vs ctx) does not
  change *where* the error surfaces.
- **Variant C.** The error rides the **stage**'s error union
  (`E | SecretsError`), surfaced *before* the downstream Source ever
  runs. This is the cleanest separation observed: `apifySource` cannot
  emit a `SecretsError` because it never resolves a secret. Failure
  mode is "stage 1 produced no input → downstream never invoked",
  which is structurally the same as a Source emitting zero atoms.
  Composer would see this as a stage-1 failure, not an apify-Source
  failure — *better blame attribution* on day-1 evidence.

No variant uses `ctx.signal.abort()` for secret failures. None throws
across a public boundary. None surfaces at run-level (i.e. the run itself
doesn't enter a "secrets failed" state — failures are per-atom or
per-stage). The composer-level question of "fail-fast vs
poison-atom-and-continue" is unanswered by all three; it's a Composer
ADR, not a placement question.

## 4. RETRY INTERACTION

Hypothetical retry — none of the variants implement it; what follows is
inferred from where the resolver call lives.

- **Variant A.** `ctx.secrets.resolve(...)` inside `iter()` runs every
  loop iteration. If the Composer retries the *atom* (not the Source),
  resolve fires once per attempt. A cache, if added, has to live on
  `ctx.secrets` itself — i.e. the resolver caches at the run scope. This
  is the natural place: every adapter reading ctx gets the same cache
  for free, and the cache lifetime aligns with the run. Rotation
  mid-run is hard: the cache key is `name`, no version, so you'd need a
  `secrets.invalidate(name)` escape hatch.
- **Variant B.** Same `iter()`-level resolve call, but the cache lives
  on the resolver instance handed in via `deps`. Two pipelines sharing
  one resolver share one cache. If the resolver is per-run, behaviour
  matches variant A. If the resolver is process-global (e.g. a
  singleton constructed at app boot), the cache is process-global —
  potentially leaks secret values across runs. Decision is structural,
  not enforced.
- **Variant C.** Resolve happens **once** at stage-1 entry, before the
  downstream Source even starts. Retry of the atom does not re-resolve
  the secret; retry of the **stage** does. This implies the retry
  granularity is "the whole pipeline (or sub-pipeline) restart from
  Secrets.fetch", which is a coarser unit than per-atom. Caching is
  effectively automatic because resolve happens once per
  pipeline-execution. Rotation mid-run requires re-running the stage
  composition, not invalidating a cache.

**Cross-variant pattern:** the location of the resolver call **is** the
caching surface. A and B push the cache onto the resolver implementation
(invisible from the type system); C makes it structural (visible: one
resolve per stage execution).

## 5. SCOPING IMPLIED

- **Variant A — per-pipeline-run.** Secrets ride ctx, ctx is constructed
  per run, lifetime = one run. Cache lives at run scope automatically.
- **Variant B — per-adapter-instance.** Resolver lives on the adapter
  closure. Lifetime = adapter lifetime, which can outlive a single run
  (e.g. a long-lived Source serving many runs in a server). Caching
  semantics depend on whether the user constructs adapters per-run or
  once at boot. *Ambiguous by default — kit must pick a convention.*
- **Variant C — per-stage-invocation.** One resolve per `.run()` of the
  composed pipeline. Coarser than per-atom, finer than per-process.
  Rotation = recompose. Multi-pipeline-run sharing requires the user to
  hold onto the composed pipeline object.

## 6. WHAT BREAKS

- **Variant A — multiple secrets per Source.** Trivially adds N resolve
  calls inside `iter()`, but no type-level signal that the Source
  declares its secret needs. A new Source author silently adds a third
  resolve and nothing in the build pipeline notices.
- **Variant B — secret rotation mid-run.** The adapter closed over a
  `secrets` reference at construction. If the adapter is constructed
  once and reused across runs (a real server pattern), the resolver
  identity is fixed — rotating means swapping the adapter, not the
  secret. Hot-rotation requires the resolver itself to be smart about
  invalidation, but the adapter has no language for "please re-fetch".
- **Variant C — secret needed at construction time vs run time.** This
  is the variant that *cannot express* "Source needs the apify-token at
  HTTP-client construction time, then again per-request". The stage
  resolves once and hands a string forward. If apify needs the token
  during HTTP client setup *and* the adapter wants to re-mint per
  request from a refresh token, variant C forces two stages
  (`Secrets.fetch('apify-refresh').through(MintAccessToken).through(
  apifySource)`), which is correct in spirit but pays the
  composition tax for what variants A/B do internally.

Additional cross-variant break (observed implementing): **secret
namespacing across multiple Sources in same pipeline.** If pipeline X
uses Apify Source v1 and Apify Source v2 with different tokens, all
three variants need a name-disambiguation strategy
(`apify-token-v1` vs `apify-token-v2`, or scoped namespaces like
`pipelines.x.apify-token`). None of the variants offers structural help
— it's a naming-convention problem outside the type system.

## 7. RANKING (brain-input only)

**Day-1 least-bad: Variant B (adapter dependency)**, narrowly, with
significant caveats.

Why B over A: B keeps `PipelineContext` minimal (run-scope only). Adding
secrets to ctx (variant A) creates an "ambient dependency" pattern that
historically grows into `ctx.secrets`, `ctx.cache`, `ctx.http`,
`ctx.metrics`, `ctx.featureFlags` — a god-object. F-AUTH 9/9 universality
means kit's answer must work for projects that compose dozens of
adapters; an ambient ctx makes "which adapter uses which secret"
non-discoverable, which is exactly the rotation-pain F-AUTH names.

Why B over C: C is structurally cleaner per-call (better blame
attribution; auto-cache; explicit error union) but pays a heavy
composition tax for multi-secret adapters and cannot express
construction-time-vs-run-time secret usage. C is also a *new
primitive* — kit currently has Source/Store/Process/Serve, and adding a
fifth stage type is a kit-shape decision that should not be made on
secrets-only grounds. If a typed-stage Secrets is right, it's right
because **all** infra deps want this treatment, which is a Cat VII / Cat
VIII joint question, not a Cat VIII Q1 question.

**Why "narrowly":** B and A are structurally near-identical at the
iterator call site. The choice between them is mostly about whether you
want secrets to be a discoverable per-adapter contract (B) or a
ctx-ambient affordance (A). Spike #2 needs to verify B under at least
two stresses before brain can lock an ADR candidate.

**What spike #2 must verify:**

1. **Rotation mid-run.** Construct a B-shaped adapter, invalidate a
   secret, observe whether the adapter naturally re-fetches or whether
   we need a new affordance (e.g. a `resolver.invalidate(name)` API or
   a versioned cache key). Test the same scenario under variant A so
   the comparison is honest.
2. **Multi-secret pipeline.** Real Apify uses
   `apify-token` + `actor-id` + `webhook-secret`. Add a second adapter
   in the same pipeline using `supabase-service-role`. Show that
   variant B's deps shape stays readable. Show whether a naming
   convention emerges or whether we need explicit scopes
   (`secrets.scope('apify').resolve('token')`).
3. **Construction-time vs run-time.** Build an adapter where the secret
   must be resolved at construction (e.g. an HTTP client with a
   bearer-token interceptor) vs at run time (per-request mint). Show
   whether B's `deps.secrets` resolves cleanly at both points or
   forces a "resolve in factory + re-resolve in iter" duplication.

If B survives those three, brain can draft a Cat VIII Q1 ADR candidate.
If B fails any one cleanly, C re-enters consideration. A is unlikely to
return unless ambient-ctx wins on a different axis (e.g. ergonomics
under deeply nested processes).

## 8. CARRY-FORWARD QUESTIONS

1. **Rotation semantics.** Does the kit's resolver expose
   `invalidate(name)` / version tags / TTL, or does the user re-construct
   the adapter? Tied to: Composer's restart semantics.
2. **Cache scope as ADR.** Run-scoped (variant A) vs adapter-scoped
   (variant B) caching is a real difference in security posture (cache
   leakage across runs). Brain must lock a default — and probably
   document escape hatches in both directions.
3. **SOPS / file-backed resolver ergonomics.** All three variants
   trivially wrap an in-memory map. None says anything about the
   real-world resolver being SOPS / age / 1Password / env-var hybrid.
   Spike #2+ must verify the resolver shape survives at least one real
   backend (SOPS most likely, given F-AUTH catalog evidence).
4. **Multi-secret pipelines + scoping.** Naming-convention vs
   structural-scope. Does `secrets.scope('apify')` belong on the
   resolver, or is hierarchical naming (`apify.token`,
   `apify.webhook-secret`) sufficient? Tied to: Cat IV (config) Q on
   how config trees compose.
5. **Construction-time secrets.** Adapters that need a secret at
   factory time (HTTP client interceptor) vs run time (per-request
   header) — does kit support both or force one shape? Probably the
   sharpest day-2 question for variant B.
6. **Stage-typed Secrets vs ambient ctx vs deps — kit-shape coherence.**
   If kit picks B for secrets, what about caches, HTTP clients, metrics
   sinks? Cat VIII Q1 isolated to secrets risks an inconsistent kit
   shape; brain may want to widen the question to "all infra deps"
   before locking.

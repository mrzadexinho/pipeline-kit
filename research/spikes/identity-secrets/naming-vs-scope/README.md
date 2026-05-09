# Cat VIII Spike #5 leg-2 sub-(1) — `naming-vs-scope`

**Throwaway code.** Probes leg-2 sub-question (1) under the leg-1 verdict
(`B + version-aware resolver` as the kit default): does **structural
scope** at the call site (`secrets.scope('apify').resolve('token')`)
provide ergonomic or discoverability value over **flat hyphenated
naming** (`secrets.resolve('apify-token')`) in a multi-secret pipeline?
Not a binding, not production-shape.

Sub-questions (2) (deps-shape) and (3) (variant C re-entry) are OUT OF
SCOPE for this spike — they run separately if brain locks them.

## What it answers (Cat VIII Q4, carry-forward #4)

A 2-cell TS spike that runs a two-stage, two-secret pipeline
(`Source(apify) → Store(supabase)`) under a single shared
`createVersionAwareResolver(real)` instance, with two call-site shapes:

|              | naming convention                          | structural scope                                   |
| ------------ | ------------------------------------------ | -------------------------------------------------- |
| **Source**   | `secrets.resolve('apify-token')`           | `secrets.scope('apify').resolve('token')`          |
| **Store**    | `secrets.resolve('supabase-service-role')` | `secrets.scope('supabase').resolve('service-role')`|

Cell (e) is the flat shape; cell (f) is the structural shape. Two atoms
per cell so per-call read inflation (or absence) is observable.

## Wrapper extension — `scope(prefix)`

The leg-1 wrapper is forked verbatim and extended with `scope()`. The
day-1 chosen shape (locked by brain — NOT a kit-spec decision):

- `scope(prefix: string)` returns a `ScopedSecretsResolver`-shaped
  sub-view.
- The sub-view's `resolve(name)`, `stats(name)`, and `invalidate(name)`
  forward to the parent wrapper's same methods with the **composite
  name** = `${prefix}-${name}` (hyphen joiner — matches the existing
  kit-shape `NAME_RE` in `mock-secrets-resolver.ts`).
- The cache map lives **on the parent wrapper instance only**. The
  sub-view is a thin façade that does name-composition; it does NOT own
  its own cache.

This means cell (e)'s `resolve('apify-token')` and cell (f)'s
`scope('apify').resolve('token')` hit the **same underlying name**
(`apify-token`) and the **same cache entry**. Runtime behaviour is
byte-identical by construction; the question Q4 asks is then purely
about call-site ergonomics + discoverability + composition tax — that
is the empirical signal brain wants.

## Friction anchor

`F-AUTH` — top-15 #2 in `docs/research-friction-catalog.md` (9/9
projects re-roll credentials with no shared rotation semantics).

## How to run

From repo root:

```bash
bash research/spikes/identity-secrets/naming-vs-scope/run-spike-5.sh
```

Runs both cells in sequence; exits 0 only on clean completion.

## Out of scope

- sub-question (2) — deps-shape under multi-secret (separate dispatch).
- sub-question (3) — variant C re-entry (separate dispatch; spike #3
  §7 says NOT triggered).
- per-scope cache forking — sub-view shares parent cache by design.
- alternative joiners (dot, dotted-name regex extension) — hyphen-only
  by spec.
- async scope construction — `scope()` is sync.
- recursive scope stress-testing — supported but not driven.
- multi-secret rotation interplay — spike #2 / #4 shape; not exercised
  alongside scoping in this leg.
- webhook-Serve fixture / HMAC — single Source + single Store pipeline.
- real backends (SOPS, Vault, AWS SM, Supabase, Apify) — mock-only.

See `FINDINGS-spike-5.md` for what was observed.

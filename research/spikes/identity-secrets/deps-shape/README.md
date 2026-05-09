# Cat VIII Spike #6 leg-3 — `deps-shape`

**Throwaway code.** Probes leg-3 (carry-forward #4 sub-question 2) under
the leg-1 + leg-2 verdicts (`B + version-aware-resolver` as kit default;
flat hyphenated naming as the default suffix shape, with `scope()` as
optional façade): when an adapter consumes **3 secrets in one
namespace**, does the deps shape change the empirical answer? Does
`{ secrets: SecretsResolver }` with multi-resolve match
`{ apifySecrets: ScopedSecretsResolver }` on runtime, discoverability,
and call-site density? Not a binding, not production-shape.

## What it answers (Cat VIII Q4, carry-forward #4 deps-shape axis)

A 2-cell TS spike that runs a **Source(apify)** factory consuming 3
secrets in the apify namespace under a single shared
`createVersionAwareResolver(real)` instance, with two deps shapes:

|              | flat / single resolver, multi-resolve            | scoped sub-resolver in deps                            |
| ------------ | ------------------------------------------------ | ------------------------------------------------------ |
| **deps**     | `{ secrets: SecretsResolver }`                   | `{ apifySecrets: ScopedSecretsResolver }`              |
| **token**    | `secrets.resolve('apify-token')` (×2 sites)      | `apifySecrets.resolve('token')` (×2 sites)             |
| **actor-id** | `secrets.resolve('apify-actor-id')`              | `apifySecrets.resolve('actor-id')`                     |
| **whsec**    | `secrets.resolve('apify-webhook-secret')`        | `apifySecrets.resolve('webhook-secret')`               |

Cell (1) is the flat shape; cell (3) is the scoped shape. Two atoms per
cell so per-call read inflation (or absence) is observable. **No Store
stage** — leg-3 is Source-only at N=3.

## Cell (2) — structurally disqualified, NOT BUILT

Cell (2) (dep-per-secret pre-resolved at construction) is documented
but not run. See `FINDINGS-spike-6.md` § 5 for the disqualification with
anchor refs to spike #2 § 8 (variant B rotation leak), spike #5 § 3.3
(cache shared by construction), and carry-forward #8 (adapter
reconstruction = Composer concern).

## Reused fixtures

- `version-aware-resolver.ts` — forked **verbatim** from spike #5
  (114 LOC; sub-view shares parent cache; hyphen joiner).
- `mock-secrets-resolver.ts` — forked from spike #5 with two new
  registrations (`apify-actor-id`, `apify-webhook-secret`). Existing
  `apify-token` and `supabase-service-role` kept for cross-spike
  comparability; supabase is harmless dead weight here.
- `mock-apify-http-client.ts` — forked from spike #5 with constructor
  surface extended for 3-secret demand (`actorId` and `webhookSecret`
  moved to construction-time; `webhookSecret` closed over but not
  invoked per-request).

## Friction anchor

`F-AUTH` — top-15 #2 in `docs/research-friction-catalog.md` (9/9
projects re-roll credentials with no shared rotation semantics).

## How to run

From repo root:

```bash
bash research/spikes/identity-secrets/deps-shape/run-spike-6.sh
```

Runs both cells in sequence; exits 0 only on clean completion. Node 22+
required for strip-types direct (bun fallback supported).

## Out of scope

- cell (2) — flag-only (see FINDINGS § 5).
- sub-question (3) — variant C re-entry (spike #5 § 8 said NOT
  triggered; this leg does not re-trigger either).
- per-scope cache forking — sub-view shares parent cache by design.
- alternative joiners — hyphen-only (carry-forward #12).
- async scope construction — `scope()` is sync.
- recursive scope stress-testing — supported but not driven.
- multi-secret rotation interplay — single-version run (no
  `invalidate()`).
- cross-namespace mixed-cardinality — apify×3 only; no supabase mixed
  in.
- HMAC envelope generalisation — `mintWebhookDigest` exported but not
  invoked.
- Webhook-Serve fixture — Source-only.
- real backends (SOPS, Vault, AWS SM, Supabase, Apify) — mock-only.

See `FINDINGS-spike-6.md` for what was observed.

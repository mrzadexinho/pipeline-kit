# Cat VIII Spike #2 — `rotation-mid-run`

**Throwaway code.** Stresses the spike-#1 §7 verdict ("variant B narrowly
least-bad") by rotating a secret partway through a run and observing how
each placement behaves. Not a binding, not production-shape.

## What it answers (Cat VIII Q1, carry-forwards Q1 + Q2)

Two structural placements over the same Apify-Source-shaped mock, with
an empirical rotation event:

- **Variant A — ctx.secrets + run-scope cache wrapper.** Cache lives on
  the per-run ctx; a fresh ctx for run #2 is a fresh cache.
- **Variant B — `Source.create({ deps: { secrets } })`.** Two sub-cases:
  - **B-CoA (cache-on-adapter)** — adapter caches the resolved token in a
    closure variable. No invalidate API on the adapter.
  - **B-CoR (cache-on-resolver)** — caching wrapper sits between adapter
    and underlying resolver, lives at adapter-construction lifetime.

The mock resolver supports `invalidate(name)` (bumps version + rotates
value to `<old>-rotated-v<n>`) and `stats(name)` (read-count +
current-version) so the harness can prove what each variant actually
sees post-rotation.

## Friction anchor

`F-AUTH` — top-15 #2 in `docs/research-friction-catalog.md` (9/9 projects
re-roll credentials with no shared rotation semantics).

## How to run

From repo root:

```bash
bash research/spikes/identity-secrets/rotation-mid-run/run-spike-2.sh
```

Runs both variant files in sequence; exits 0 only on clean completion.

## Out of scope

- real SOPS / age / 1Password / env-var hybrid backends (spike #3+)
- multi-secret-per-pipeline (spike #4)
- construction-time vs run-time secrets (spike #3)
- `subscribe(name, onChange)` push-rotation patterns (open question)

See `FINDINGS-spike-2.md` for what was observed.

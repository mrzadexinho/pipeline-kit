# Cat VIII Spike #1 — `where-does-it-live`

**Throwaway code.** Surfaces friction in *where* `SecretsAdapter` lives in
the type system, before brain commits any v1 ADR. Not a binding, not
production-shape.

## What it answers (Cat VIII Q1)

Three structural placements over the same Apify-Source-shaped mock:

- **(A) Context concern** — `ctx.secrets.resolve('apify-token')` inside
  `Source.iter()` (secrets ride the run-scoped context).
- **(B) Adapter dependency** — `Source.create({ deps: { secrets } })`
  (secrets injected at construction; no ctx coupling).
- **(C) Stage type** — `Secrets.fetch('apify-token').through(apifySource)`
  (secret resolution is its own typed pre-stage).

Same in-memory resolver fixture across all three so comparisons are honest.

## Friction anchor

`F-AUTH` — top-15 #2 in `docs/research-friction-catalog.md` (9/9 projects
re-roll credentials with no shared rotation semantics).

## How to run

From repo root:

```bash
bash research/spikes/identity-secrets/where-does-it-live/run-spike-1.sh
```

Pipeline runs each variant in turn; exits 0 only if all three succeed.

## Out of scope

- rotation semantics, cache invalidation, SOPS ergonomics — spike #2+
- multi-secret-per-source pipelines — spike #2+
- real I/O — resolver is in-memory only

See `FINDINGS-spike-1.md` for what was observed.

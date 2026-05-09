# Cat VIII Spike #3 — `factory-and-runtime`

**Throwaway code.** Stresses the spike-#1 §7 + spike-#2 §6 mixed verdict
on the construction-time-vs-run-time axis (carry-forward Q5 from
spike-#1; carry-forward #5 UNCHANGED from spike-#2 — this spike attacks
it). Not a binding, not production-shape.

## What it answers (Cat VIII Q1, carry-forward Q5 / #5)

Two structural placements over a shared Apify-shaped HTTP-client mock
where the same secret (`apify-token`) is needed at TWO sites:

- once at HTTP-client **factory time** (interceptor stamps
  `Authorization: Bearer <...>` once);
- once at **run time** per request (signer mints
  `x-apify-call-id` per call from the live token).

Cells:

- **Variant A — ctx.secrets, deferred-construction (A.2 + A.3).** No
  factory-stage signal in A; the bearer resolve is deferred into
  `iter()` first call. Signer closure also reads from `ctx.secrets`.
- **Variant B sub-cell B.1 — close-over.** Factory resolves bearer
  once; signer closure captures the same string. Single resolve.
- **Variant B sub-cell B.2 — re-resolve at run-time.** Factory resolves
  for HTTP-client construction; signer re-resolves on every call via
  `deps.secrets`. Two resolution sites.

The mock HTTP client (`mock-apify-http-client.ts`) is a node-stdlib-only
fixture — `console.log` for "the request", `node:crypto` HMAC for the
throwaway per-call signature. NO real network, NO `fetch`.

## Friction anchor

`F-AUTH` — top-15 #2 in `docs/research-friction-catalog.md` (9/9 projects
re-roll credentials with no shared rotation semantics).

## How to run

From repo root:

```bash
bash research/spikes/identity-secrets/factory-and-runtime/run-spike-3.sh
```

Runs both variant files in sequence; exits 0 only on clean completion.

## Out of scope

- rotation stress (spike #2 covered; do NOT call `invalidate()` here)
- version-aware resolver wrapper (spike #4 leg-1)
- multi-secret pipelines (spike #4 leg-2)
- variant C (typed Secrets stage) implementation — re-entry condition
  only, flagged in FINDINGS §7
- real Apify SDK / real HTTP / real signing scheme
- adapter library deps beyond node stdlib (`node:crypto` allowed)
- `subscribe(name, onChange)` / push-rotation patterns

See `FINDINGS-spike-3.md` for what was observed.

# Cat VIII Spike #4 leg-1 — `version-aware-resolver`

**Throwaway code.** Probes spike-#3 §8 carry-forward #7 (version-aware
resolver default) directly: does wrapping the real resolver in a
version-stamped caching wrapper collapse the B.1 vs B.2 sub-question?
Not a binding, not production-shape.

Leg-2 (multi-secret) is OUT OF SCOPE for this spike — runs in a
separate session.

## What it answers (Cat VIII Q1, carry-forward #7 / #8)

A wrapper `createVersionAwareResolver(real)` consults
`real.stats(name).current_version` on every `resolve(name)` and drops
its cache entry when the version moves. We then run the spike-#3
two-site harness AND the spike-#2 rotation harness against B.1
(close-over) and B.2 (re-resolve) adapter shapes — four observable
cells in a 2×2 matrix:

|                 | two-site harness (spike #3 shape) | rotation harness (spike #2 shape) |
| --------------- | --------------------------------- | --------------------------------- |
| **B.1 close-over**  | cell (a)                       | cell (c)                          |
| **B.2 re-resolve**  | cell (b)                       | cell (d)                          |

The headline question: under the wrapper, do B.1 and B.2 produce
identical observables across both harnesses (full collapse), partial
collapse, or no collapse? See `FINDINGS-spike-4.md` § 4.

The wrapper does NOT proactively drop its cache when `invalidate(name)`
is called on it — the version-stamp probe on the next `resolve(name)`
is the cache-drop mechanism. This is intentional; brain wants to
observe whether version-stamp-only is sufficient.

## Friction anchor

`F-AUTH` — top-15 #2 in `docs/research-friction-catalog.md` (9/9 projects
re-roll credentials with no shared rotation semantics).

## How to run

From repo root:

```bash
bash research/spikes/identity-secrets/version-aware-resolver/run-spike-4.sh
```

Runs both adapter-shape variants in sequence; exits 0 only on clean
completion. Each variant file emits its two cells (a)+(c) for B.1,
(b)+(d) for B.2.

## Out of scope

- multi-secret pipelines — spike #4 leg-2 (separate dispatch)
- TTL-based caching — wrapper composes with future TTL layer; not
  probed here
- `subscribe(name, onChange)` / push-rotation — pull-only via stats
  version stamp by design
- variant C re-implementation — spike-#3 §7 says re-entry NOT
  triggered
- variant A under wrapper — spike-#3 §6 firmed up B as the natural
  fit; wrapping A adds nothing
- adapter reconstruction (carry-forward #8) — wrapper closes the leak
  for re-readable secrets; whether the kit also needs reconstruction
  for non-re-readable shapes (e.g. long-lived TCP connections built
  with stale credentials) is left for synthesis
- real backends (SOPS, age, 1Password, Vault) — mock-only
- real Apify SDK / real HTTP — node-stdlib fixture only

See `FINDINGS-spike-4.md` for what was observed.

# pipeline-kit — Development Rules

> Read this before writing any code or doc in this repo.

## What this is

A typed-stage TypeScript automation library: `Source<O>`, `Store<T>`,
`Process<I,O>`, `Serve<I>`, plus a Composer that wires them with retry,
rate-limit, idempotency, observability, and HRP-review checkpoints.

Aligned with Gatewerk family conventions (Stripe-style API, HMAC webhook
signing, Result<T,E>, Zod boundaries).

## Phase discipline

- **Phase 1 (research):** read sources, take structured notes per
  `docs/research-outline.md`. NO code. NO spec resolution. Surface patterns
  + open questions.
- **Phase 2 (spec):** lock ADRs + API surface + adapter list + test plan in
  `docs/spec.md`. Still no code. Brain authority.
- **Phase 3 (build):** code + tests + first reference project. Executor
  authority.

Do not skip phases. Each ends when defensible, not on calendar.

## Engineering rules

### Language + runtime
- TypeScript primary; Node 20+ target; Bun-tested in CI.
- ESM modules; no CommonJS.

### File size
- **Soft limit: 300 lines.** Plan a split when approaching.
- **Hard limit: 500 lines.** Never commit past.

### Type safety
- Strict TypeScript (`strict: true`, no `any`).
- Result<T, E> for all stage outputs; no thrown errors crossing public API.
- Zod schemas at every Source / Serve boundary.

### Testing
- Vitest + fast-check for property tests.
- Property tests prove kit-level laws (idempotency, round-trip, cancellation).
- Unit + integration tests mirror `src/` structure.
- `npm test` runs everything; CI green required.

### Conventions (aligned with Gatewerk family)
- Prefixed object IDs: `pk_pipe_`, `pk_run_`, `pk_atom_`, `pk_src_`,
  `pk_proc_`, `pk_serve_`.
- Response envelope: `id`, `object`, `created_at`, `metadata` on every
  emitted resource.
- Idempotency keys mandatory on Serve adapters mutating external state.
- HMAC-SHA256 + timestamp tolerance for webhook signing.
- Actionable errors: `type`, `code`, `message`, `param`, `doc_url`.
- OpenTelemetry traces native; structured logs.

### Dependencies
- Managed via `pnpm` (matches Gatewerk monorepo convention).
- Direct deps minimized; explicit alternatives ADR'd in `docs/spec.md`.
- No copy-paste from other projects without provenance check.

### Style
- Functional core, imperative shell.
- No `class` for behavior unless lifecycle (e.g., resource cleanup) demands it.
- Pure Process functions; side-effects pushed to Source/Serve boundaries.
- No emojis in code or commit messages unless user asks.

### What to lift from family projects
- Gatewerk's API design conventions (already applied — Stripe-pattern lift)
- Gatewerk's TypeScript SDK ergonomics (createClient factory, env-var
  fallback, discriminated-union responses)
- Gatewerk's HRP protocol — pipeline-kit speaks HRP natively, not just to
  Gatewerk-the-product
- Pursuit's adapter pattern (Source/Store/Analysis/Output) — naming +
  structure inspires pipeline-kit's typed stages

### What NOT to lift
- Gatewerk's HITL UI logic — that's Gatewerk's product, not kit's
- Pursuit's mode-specific routing — kit is product-agnostic
- Mediaflow's multi-tenant patterns — that's mediaflow's product, not kit's

## Anti-patterns (reject in review)

- Files > 500 lines.
- Throwing errors across public stage boundary (use Result<T,E>).
- Untyped `any` in stage signatures.
- Bypassing Zod boundary validation.
- Mutating shared Context outside the orchestrator.
- New ADRs landing in `docs/spec.md` without research-note backing.
- Adding adapters speculatively (every adapter must serve a real reference
  project's need).

## Commands

```bash
pnpm install
pnpm test                    # Vitest + fast-check
pnpm run build               # tsup or tsc
pnpm run typecheck
pnpm run lint                # eslint or biome
pnpm run format
```

(Tooling specifics locked in Phase 2 spec.)

## Release flow (locked 2026-05-09 in M0.5b)

Kit ships under npm scope **`@idriszade/*`** (NOT `@pipeline-kit/*` — that
scope was taken). Repo identity stays `pipeline-kit`; only npm scope is
`@idriszade`. Babel pattern: repo `babel/babel` ships `@babel/*`.

Version bumps go through **changesets**. Before merging any change that
warrants a publish:

1. `pnpm changeset` — interactive: select packages + bump type + summary
2. Commit the resulting `.changeset/<random>.md` with the change
3. Push to master
4. `.github/workflows/release.yml` auto-runs changesets/action — bumps
   versions, generates CHANGELOGs, publishes to npm

Workflow auth requires both `NPM_TOKEN` AND `NODE_AUTH_TOKEN` env vars
(setup-node interpolates the latter into `~/.npmrc`). Both already wired
in `release.yml`; do NOT remove either.

**Trusted Publishing (SLSA provenance)** queued for v0.2.0+ — configure
per-package on npmjs.com after v0.1.0 packages exist on registry. Then
re-enable `NPM_CONFIG_PROVENANCE: true` in release.yml (currently
commented out with `TODO(post-v0.1.0)`).

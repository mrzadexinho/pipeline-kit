# Cat IX Spike #1 — Cross-Runtime Single-Atom Round-Trip

**Throwaway code.** This spike is not a binding, not a reusable adapter,
not a packaged Python sibling to `@pipeline-kit/core`. It exists to surface
friction in pipeline-kit primitives crossing a runtime boundary, before
brain commits to any v1 ADR.

## What it answers

1. Does `Result<T, E>` (`{data, error}` discriminated union, ADR4) survive
   JSON in both directions?
2. Does `Atom<T>` envelope (`id`, `object`, `created_at`, `metadata`, `data`)
   round-trip cleanly?
3. Is hand-walking Zod ↔ Pydantic feasible, or does codegen become a v1
   must-have?
4. Are pk-prefixed IDs (`pk_atom_<ULID>`) preserved exactly across the wire?
5. Is timestamp format locked anywhere, or implicit?

See `FINDINGS.md` for the answers.

## Out of scope

- streaming / `iter()` — single `fetch()` atom only
- `PipelineContext` (signal, trace, idempotencyKey) — TS-side only
- envelope shootout (JSON-RPC, MCP, HTTP) — pure stdio
- a `pipeline_kit_py` package — no setup.py / pyproject.toml
- importing real `@pipeline-kit/core` — schemas inlined for spike isolation

## How to run

From repo root:

```bash
bash research/spikes/cross-runtime/run.sh
```

Pipeline: `node ts/atom-emit.ts | uv run --with 'pydantic>=2' python3 py/process_atom.py | node ts/result-validate.ts`

Exits 0 on round-trip success.

## Files

- `ts/atom-emit.ts` — TS Source-equivalent: builds 1 fake `Atom<Job>`,
  wraps in `Result`, prints JSON to stdout.
- `ts/validate.ts` — hand-rolled validator (zod not resolvable in repo).
- `ts/result-validate.ts` — TS sink: read JSON Result, validate, exit 0/non-0.
- `py/schema.py` — hand-written Pydantic v2 mirror of the synthetic Job schema.
- `py/process_atom.py` — Python Process: validate, mutate (uppercase title),
  re-emit Result envelope.
- `run.sh` — end-to-end pipe.
- `FINDINGS.md` — friction surfaced (read this).

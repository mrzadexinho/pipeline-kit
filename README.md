# pipeline-kit

> Typed-stage automation library — `Source → Store → Process → Serve`. The
> abstraction layer beneath the workflow engine, above the tool aggregator.

**Status:** Phase 1 (Deep Research) — researching architectural patterns before
spec or code is written. v0 ship target post-Phase 2.

## What this is

A thin TypeScript library naming the four stages of any automation as typed
interfaces, shipping reference adapters per stage, and providing a Composer
that wires them with retry / rate-limit / idempotency / observability /
HRP review checkpoints built in.

Aligned with [Gatewerk](https://github.com/mrzadexinho/gatewerk) for HITL
primitives (HRP — Human Review Protocol). Composes with — does not replace —
workflow engines (n8n / Activepieces / Make), agent runtimes (LangGraph /
Pydantic AI), and tool aggregators (Composio).

## Status

- **Phase 1 (current):** deep research across 6 engineering axes + 4 business
  axes + competitive landscape + inspiration mining. See
  `docs/research-outline.md` for full scope.
- **Phase 2 (next):** lock ~20 ADRs + API surface + reference adapter list
  in `docs/spec.md`.
- **Phase 3:** v0 build + first reference project (Trades Outbound,
  OperatorOS productization template).

## Family-of-products context

Same architect (Idris Idriszade), same conventions (Stripe-style API design,
HMAC webhook signing, Result<T, E> error handling, Zod-validated boundaries):

- [pursuit](https://github.com/mrzadexinho/pursuit) — opportunity-pursuit
  framework + demand mining (parallel evolution; provides `PursuitDemandSource`)
- [gatewerk](https://github.com/mrzadexinho/gatewerk) — HITL station
  (Apache 2.0, v1.0+v1.1 in production) — reference HRP implementation
- [orchestr8-mcp](https://github.com/mrzadexinho/orchestr8) — agent
  coordination (memory backend for pipeline-kit Composer)
- [devshield](https://github.com/mrzadexinho/devshield) — code review
  suite (codeguard / scanline / migratoor / docguard) used as Process primitives

## Reading

Start with `docs/research-outline.md`. Phase 1 reading list lives in Section 13
of that doc — ~58 sources across 10 categories, optimized for Claude Code
bulk consumption.

## License

TBD — Apache 2.0 leaning (matches Gatewerk family convention).

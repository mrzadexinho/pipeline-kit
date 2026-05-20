# M5 Audit Findings — IV-4 / IV-5 / IV-6 / III-2

> **Status:** Audit complete 2026-05-20. 0/4 ADRs fully shipped. 4/4 require M5 build work to reach conformance. Gap stays 8/55; M5 will be a real shipping milestone, not a doc pass.

## Summary

A code-level audit of four ADRs from the M2/M4 build period — IV-4 (TriggerAdapter dev/prod seam), IV-5 (RunGuard 5 shapes), IV-6 (full pipeline idempotency), and III-2 (parentTraceContext threading) — found all four PARTIAL or NOT-SHIPPED. The interface and type scaffolding exists in most cases, but the adapter translation layers have specific gaps: no dev-mode TriggerAdapter, `dedup.period` silently dropped, concurrency-reject semantics inverted vs Inngest, HMAC omitted from idempotency key derivation, and `parentTraceContext` accepted but immediately dropped. Two modern-standard adjustments are recorded as addenda (Inngest `singleton` primitive for true-reject, HKDF-derived HMAC subkey, OTel W3C propagation API) — these update the *adapter implementation* approach, not the kit-core API surface.

## Audit verdicts

### ADR IV-4 — TriggerAdapter dev/prod seam

**Verdict:** PARTIAL.

Evidence:
- Inngest adapter present at `packages/adapter-inngest/src/inngest-trigger-adapter.ts:13`; `TriggerAdapter` interface (`packages/core/src/trigger.ts:29-33`) satisfied; all 5 `TriggerConfig.kind` cases handled via `mapTriggerConfig` (`create-kit-function.ts:85-102`).
- No dev-mode adapter exists anywhere in `packages/`. The local-prod-seam promise (the third confirmation of the seam pattern per the ADR text) is half-shipped.

Spec drift to note: interface returns `Promise<void>` not `void`; `start()`/`stop()` lifecycle methods added beyond the ADR text. These are sensible runtime additions; spec should be updated to match.

### ADR IV-5 — RunGuard 5 shapes

**Verdict:** PARTIAL.

Evidence:
- Type supports all 5 shapes structurally (`packages/core/src/trigger.ts:8-16`). Declaration-only kit-core matches the ADR.
- `dedup.period` is silently dropped in adapter translation (`packages/adapter-inngest/src/create-kit-function.ts:109-130`). The period value never reaches Inngest.
- Concurrency key wiring is inverted vs Inngest semantics: `overflow:'reject'` gets a key (which produces per-key serialised queueing in Inngest), while `overflow:'queue'` gets no key. Inngest's `concurrency[]` always queues extras — it does not natively reject. True-singleton (reject) cannot be expressed via `concurrency[]` at all.
- Zero per-shape conformance tests in `packages/adapter-inngest/test/`.

Modern-standard adjustment (NOT a spec rewrite — record as an addendum):
- Inngest shipped a `singleton: { key, mode: 'skip' | 'cancel' }` primitive (v4) explicitly for true-singleton semantics. M5 will adopt this for `overflow:'reject'`. Note: this changes the *adapter* translation, not the kit-core RunGuard type. The 5-shape API stays.

### ADR IV-6 — Full pipeline idempotency

**Verdict:** PARTIAL.

Evidence:
- Input side: `dedupKey` field present on `KitTriggerEnvelope` (`packages/core/src/trigger.ts:24`). Adapter sets `idempotency: 'event.data.dedupKey'` ONLY when `runGuard.dedup` is configured (`create-kit-function.ts:125-127`). An envelope carrying `dedupKey` without explicit `runGuard.dedup` is silently un-deduped. Single grep hit for `idempotency` across `packages/adapter-inngest/src/`.
- Output side: `scopedIdempotencyKey` (`packages/core/src/composer/idempotency.ts:13-15`) returns plain string concatenation `${runId}:${serveAdapterId}:${atomId}`. No HMAC. The ADR text mandates "HMAC-signed idempotency key". HMAC exists in `core/src/webhooks/sign.ts` and `serve-webhook/src/webhook-serve.ts` but is not wired to idempotency.

Modern-standard adjustment to record: M5 will use HKDF-derived subkey (RFC 5869) from a master `PK_SIGNING_KEY` env var with `info='pk-idempotency-v1'`, native `crypto.hkdfSync` + `crypto.createHmac`. Falls back to webhook signing key with deprecation log if master unset. This is the modern key-separation pattern (Signal, Stripe, AWS KMS use it).

### ADR III-2 — parentTraceContext threading

**Verdict:** NOT-SHIPPED.

Evidence:
- `RunOptions.parentTraceContext?: TraceContext` declared at `packages/core/src/pipeline-types.ts:16`, but `definePipeline.run()` (`packages/core/src/define-pipeline.ts:61-67`) does not forward it to the inner `pipeline.run()` call. The field is accepted and immediately dropped.
- `kitFanOut` (`packages/adapter-inngest/src/kit-fan-out.ts:30-33`) passes only `{ function, data: item }` to `step.invoke`. No trace context extracted from the parent step context; no carrier injected into the child invocation payload.
- Zero hits for `parentTraceContext` across `packages/adapter-inngest/src/`.

Modern-standard adjustment: M5 will use the W3C Trace Context propagation API from `@opentelemetry/api` — `propagation.inject(context.active(), carrier)` at fan-out and `propagation.extract` on child entry. Carrier embedded under reserved key `_pk_trace` in the `step.invoke` data envelope. This is the OTel-recommended pattern; no custom serialization.

## M5 scope decisions

**In-scope (audit closure — mandatory):**
1. IV-4 — ship `LocalTriggerAdapter` (dev-mode cron via `setInterval`, webhooks via native Node `http.createServer` — no express dep). Location: export from `@idriszade/core` (zero new package, zero new deps). Update spec drift on interface signature (`Promise<void>` + start/stop).
2. IV-5 — fix `dedup.period` forwarding; rewrite concurrency translation to adopt Inngest `singleton` primitive for `overflow:'reject'` and bare `concurrency[]` for `overflow:'queue'`; add 5-named-shape conformance tests; add explicit translation table in adapter README.
3. IV-6 input-side — set `fnConfig.idempotency = 'event.data.dedupKey'` unconditionally (Inngest treats undefined expression result as no-dedup), independent of `runGuard.dedup`.
4. IV-6 output-side — replace `scopedIdempotencyKey` with HKDF-derived HMAC-SHA256; introduce `PK_SIGNING_KEY` env var; `crypto.timingSafeEqual` on verification paths.
5. III-2 — forward `parentTraceContext` in `define-pipeline.ts:61-67`; in `kitFanOut`, OTel `propagation.inject` into `step.invoke` data envelope; child extracts on entry.

**In-scope (small carry-forwards that pair naturally):**
6. Composer auto-attach `pk.pii_annotations` from Process Zod schema metadata at definePipeline time (closes VIII-6.f).
7. `createVersionAwareResolver` per-resolve version probe via `inner.stats(name).currentVersion` (closes VIII-2 conformance).
8. Allowlist redaction mode (`RedactionMode = 'denylist' | 'allowlist'`); allowlist requires explicit `.meta({ pii: 'safe' })` tag (closes VIII-6.g).

**Deferred to M6+:**
- `@idriszade/cost` pricing pack (X-4)
- Rate-limit RunGuard shape as new shape #6 (beyond audit closure)
- `memory-map` adapter (V-6)
- Python wire codegen (IX-2) — separate cross-runtime milestone
- M2 CLI carry-forwards (stdin `pk run`, webhook trigger, full cron, `pk scaffold`) — DX-focused milestone candidate

## Branch state at audit time

- master tip `1b430b2` is 1 commit ahead of `origin/master` — needs push (separate authorisation).
- Stale local branches: `m2-durable-execution`, `m4-secrets-redaction` — safe to prune; not addressed in this audit.
- Untracked: `.claude/projects/`, `.clone/` — outside scope.
- Dirty: `M .claude/commands/brain.md` — outside scope.

## Carry-over questions for M5 brief

- Test count delta target (audit fixes likely add ~40-60 tests across the 4 ADRs + 3 polish items).
- Changeset bump: M5 contains breaking changes to RunGuard adapter translation behaviour (`overflow:'reject'` semantics correction); flag as minor (0.3.0) per kit's pre-1.0 stance, not major.
- `LocalTriggerAdapter` requires no new package — verify by ensuring zero new deps in `packages/core/package.json`.

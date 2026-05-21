---
'@idriszade/core': minor
'@idriszade/cost': minor
---

M6: spend-aware runtime guards — verifyWebhook, RateLimitGuard, BudgetCeiling, plus @idriszade/cost pricing pack.

- feat(core): verifyWebhook general-purpose HMAC verifier — multi-key rotation, 300s tolerance, Result<true, VerifyError>. Closes M5 cf #2.
- feat(core): RateLimitGuard as 6th RunGuard shape (declaration-only; ADR X-5 in-process scope) + InProcessRateLimitStore reference impl (sliding-window log, LRU 1024 keys). Distributed adapter (Redis) deferred to M7.
- feat(core): BudgetCeiling cumulative spend tracking on Composer — 4-axis (maxDollars/input/output/requests); warnAtFraction default 0.80; Inngest replay-safe via recomputeAccumulation pure reducer over run.steps[]. Reuses existing runtime_budget_exceeded StageErrorCode. Closes cf-X-4.
- feat(cost): NEW @idriszade/cost pack — 12-entry bundled PRICES table (Anthropic / OpenAI / OSS); 4-field Anthropic-cache-accurate TokenUsage; LAST_UPDATED 2026-05-20; customPrices override; Zod boundary validation; pricing accuracy stance documented. Closes ADR X-4.
- refactor(core): extract budget ceiling enforcement out of composer.ts (568 LOC → 423 LOC) to comply with 500 LOC hard limit.
- chore(lint): sweep 84 biome warnings + 36 infos to zero (M5 cf #6).

/**
 * Cat X Spike — Cell B: Cost Budget Guard
 * Q2: Cost cap declaration shape  Q5: Reviewable<I> interaction
 *
 * Ground: Stripe Billing Meters + threshold alerts, RunGuard (Cat IV ADR-IV-5),
 *         HRP Reviewable<I> (M0 kernel), StageErrorCode taxonomy (Cat VI ADR-VI-3).
 */
export {};

// ─── Inline Kit Types ────────────────────────────────────────────────────────

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

interface UsageAccumulator {
  record(metric: string, value: number): void;
  get(metric: string): number;
  getAll(): ReadonlyMap<string, number>;
}

function makeUsageAccumulator(): UsageAccumulator {
  const map = new Map<string, number>();
  return {
    record(m, v) { map.set(m, (map.get(m) ?? 0) + v); },
    get(m) { return map.get(m) ?? 0; },
    getAll() { return map as ReadonlyMap<string, number>; },
  };
}

// ─── §1: CostBudget as declaration shape (RunGuard pattern) ──────────────────

/**
 * Kit-core defines the TYPE. Composer checks between stages.
 * Ground: Stripe billing thresholds (80% alert → invoice → cap).
 * Mirrors RunGuard (Cat IV ADR-IV-5): declaration-only in core, adapter enforces.
 */
interface CostBudget {
  metric: string;                          // e.g., 'cost.usd' or 'gen_ai.usage.input_tokens'
  limit: number;                           // e.g., 5.00 (USD) or 100_000 (tokens)
  action: "abort" | "review" | "warn";    // gradient of enforcement
}

// Kit-defined StageErrorCode taxonomy (Cat VI ADR-VI-3) — 18 codes + new addition:
// §2: runtime_budget_exceeded (19th code, Runtime category, retryable: false)
type StageErrorCode =
  | "runtime_retry_exhausted"
  | "runtime_cancelled"
  | "runtime_concurrency_rejected"
  | "runtime_budget_exceeded"            // ← NEW: Cat X addition #19
  | "source_unavailable"
  | "process_validation_failed";         // ...abbreviated

interface StageError {
  type: "stage_error";
  code: StageErrorCode;
  message: string;
  retryable: boolean;
  param?: string;
  doc_url?: string;
}

// VERDICT: PASS — runtime_budget_exceeded is NON-retryable (spending more won't
// help). Stripe usage caps terminate service, not retry. 18→19 codes.

// ─── §2: Composer budget check between stages ─────────────────────────────────

interface PipelineContext {
  runId: string;
  signal: AbortSignal;
  attempt: number;
  trace: { traceId: string; spanId: string };
  usage: UsageAccumulator;
  deps: Record<string, unknown>;
}

type ReviewablePayload<I> = { input: I; reason: string; runId: string };
type ReviewDecision = "approve" | "reject";

/** Simulated Composer budget check. Called between stages. */
function checkBudgets(
  ctx: PipelineContext,
  budgets: CostBudget[],
  controller: AbortController,
  // Stub: HRP review callback (Reviewable<I> is M0 kernel primitive)
  requestReview: (payload: ReviewablePayload<string>) => Promise<ReviewDecision>
): Promise<Result<void, StageError>> {
  return (async () => {
    for (const budget of budgets) {
      const current = ctx.usage.get(budget.metric);
      if (current < budget.limit) continue;

      if (budget.action === "abort") {
        controller.abort();
        return {
          ok: false,
          error: {
            type: "stage_error",
            code: "runtime_budget_exceeded",
            message: `Budget exceeded: ${budget.metric} ${current} >= ${budget.limit}`,
            retryable: false,
            doc_url: "https://pipeline-kit.dev/errors/runtime_budget_exceeded",
          } satisfies StageError,
        };
      }

      if (budget.action === "warn") {
        // Emit OTel event, continue — no interruption
        console.warn(`[WARN] budget ${budget.metric}: ${current}/${budget.limit}`);
        continue;
      }

      if (budget.action === "review") {
        // Route to HRP Reviewable<I> — NOT a new primitive
        const decision = await requestReview({
          input: `Pipeline has spent ${current} of ${budget.limit} ${budget.metric}. Approve continuation?`,
          reason: "budget_threshold_reached",
          runId: ctx.runId,
        });
        if (decision === "reject") {
          return {
            ok: false,
            error: {
              type: "stage_error",
              code: "runtime_budget_exceeded",
              message: `Human rejected continuation: ${budget.metric}`,
              retryable: false,
            } satisfies StageError,
          };
        }
        // Human approved → continue
      }
    }
    return { ok: true, value: undefined };
  })();
}

// ─── §3: CostBudget + Reviewable<I> composition probe ───────────────────────

const controller = new AbortController();
const ctx: PipelineContext = {
  runId: "pk_run_003",
  signal: controller.signal,
  attempt: 1,
  trace: { traceId: "t-003", spanId: "s-003" },
  usage: makeUsageAccumulator(),
  deps: {},
};

// Simulate expensive stage spending $4.50 of $5.00 budget
ctx.usage.record("cost.usd", 4.50);

const budgets: CostBudget[] = [
  { metric: "cost.usd", limit: 5.00, action: "abort" },
  { metric: "gen_ai.usage.input_tokens", limit: 100_000, action: "warn" },
];

// §3 probe: budget NOT yet exceeded (4.50 < 5.00) — continue
const mockReview = (_p: ReviewablePayload<string>): Promise<ReviewDecision> =>
  Promise.resolve("approve");

(async () => {
  const check1 = await checkBudgets(ctx, budgets, controller, mockReview);
  // VERDICT: PASS — 4.50 < 5.00 → no interruption
  console.assert(check1.ok === true, "Should pass when under budget");

  // Now spend another $0.60 pushing total to $5.10 → abort
  ctx.usage.record("cost.usd", 0.60);
  const check2 = await checkBudgets(ctx, budgets, controller, mockReview);
  // VERDICT: PASS — 5.10 >= 5.00 → abort with runtime_budget_exceeded
  console.assert(check2.ok === false);
  if (!check2.ok) {
    console.assert(check2.error.code === "runtime_budget_exceeded");
    console.assert(check2.error.retryable === false);
  }
})();

// ─── §4: Budget on pipeline.run() options ────────────────────────────────────

/**
 * Proposed API — array of budgets, each independent.
 * Ground: Stripe supports multiple meters per subscription.
 */
interface RunOptions {
  costBudget?: CostBudget[];
  idempotencyKey?: string;
}

function simulatePipelineRun(
  _input: unknown,
  options: RunOptions = {}
): string {
  const budgetSummary = (options.costBudget ?? [])
    .map(b => `${b.metric} ≤ ${b.limit} → ${b.action}`)
    .join(", ");
  return `run started with budgets: [${budgetSummary}]`;
}

const summary = simulatePipelineRun("some-input", {
  costBudget: [
    { metric: "cost.usd", limit: 5.00, action: "abort" },
    { metric: "gen_ai.usage.input_tokens", limit: 100_000, action: "warn" },
  ],
});
// VERDICT: PASS — array-of-CostBudget on RunOptions; Composer checks all.
console.assert(summary.includes("cost.usd"));

// ─── §5: Rate limiting is adapter-tier, NOT budget ──────────────────────────

/**
 * Rate limiting (req/s) ≠ budget (total spend). Entirely distinct concerns.
 * Inngest has built-in rateLimit on functions; kit declares concurrency via
 * RunGuard (IV-5) and delegates. Kit-core has NO rate limiter.
 *
 * Conceptual: adapter-inngest wraps kit stage with Inngest rateLimit config.
 * Kit-core never sees req/s numbers.
 */
interface InngestFunctionConfig {
  id: string;
  rateLimit?: {
    limit: number;
    period: "1s" | "1m" | "1h";
    key?: string;
  };
  // ... other inngest config
}

function buildInngestConfig(stageId: string): InngestFunctionConfig {
  return {
    id: stageId,
    rateLimit: { limit: 10, period: "1s" },  // adapter concern, NOT kit RunOptions
  };
}

const inngestCfg = buildInngestConfig("source-apify-scrape");
// VERDICT: PASS — rate limit is in InngestFunctionConfig (adapter), not CostBudget.
// Kit delegates to Inngest rateLimit, consistent with RunGuard (IV-5) delegation.
console.assert(inngestCfg.rateLimit?.limit === 10);

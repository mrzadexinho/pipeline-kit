import { createContext, type PipelineContext } from '../context.js';
import type { RunError } from '../errors/run.js';
import type { RetryPolicy } from '../policy.js';
import { err, ok, type Result } from '../result.js';
import { cancelledResult, isCancelled } from './cancellation.js';
import { generateIdempotencyKey } from './idempotency.js';
import { type StageName, withSpan } from './otel.js';
import type { TokenBucket } from './rate-limit.js';
import {
  createRetryBudget,
  DEFAULT_RETRY_POLICY,
  mergeRetryPolicy,
  type RetryBudget,
  withRetry,
} from './retry.js';

export interface ComposerStep {
  id: string;
  kind: StageName;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucket;
  run: (
    input: unknown,
    ctx: PipelineContext,
  ) => Promise<
    Result<unknown, { type: string; code: string; message: string; retry_after_ms?: number }>
  >;
}

export interface ComposerOpts {
  pipelineId: string;
  steps: ReadonlyArray<ComposerStep>;
  initialInput?: unknown;
  globalRetryPolicy?: Partial<RetryPolicy>;
  globalRetryBudget?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ComposerResult {
  runId: string;
  pipelineId: string;
  output: unknown;
  atomCount: number;
  duration: number;
  metadata: Record<string, unknown>;
  ctx: PipelineContext;
}

export async function runComposer(opts: ComposerOpts): Promise<Result<ComposerResult, RunError>> {
  const ctx = createContext({
    pipelineId: opts.pipelineId,
    metadata: opts.metadata,
    signal: opts.signal,
    idempotencyKey: opts.idempotencyKey ?? generateIdempotencyKey(),
  });

  const startTime = Date.now();
  const globalPolicy = mergeRetryPolicy(DEFAULT_RETRY_POLICY, opts.globalRetryPolicy);
  const budget = makeBudget(opts.globalRetryBudget, opts.steps.length, globalPolicy.maxAttempts);

  let currentInput: unknown = opts.initialInput;
  let stagesCompleted = 0;

  for (const step of opts.steps) {
    if (isCancelled(ctx.signal)) {
      return cancelledResult();
    }

    const stagePolicy = mergeRetryPolicy(globalPolicy, step.retryPolicy);
    const stageOutcome = await runStage(step, currentInput, ctx, stagePolicy, budget);

    if (stageOutcome.error !== null) {
      return err(toRunError(step, stageOutcome.error, ctx));
    }
    if (isCancelled(ctx.signal)) {
      return cancelledResult();
    }
    currentInput = stageOutcome.data;
    stagesCompleted++;
  }

  return ok({
    runId: ctx.runId,
    pipelineId: ctx.pipelineId,
    output: currentInput,
    atomCount: stagesCompleted,
    duration: Date.now() - startTime,
    metadata: { ...ctx.metadata },
    ctx,
  });
}

async function runStage(
  step: ComposerStep,
  input: unknown,
  ctx: PipelineContext,
  policy: RetryPolicy,
  budget: RetryBudget,
): Promise<
  Result<unknown, { type: string; code: string; message: string; retry_after_ms?: number }>
> {
  return withSpan(
    step.kind,
    { runId: ctx.runId, pipelineId: ctx.pipelineId, stageId: step.id },
    () =>
      withRetry(
        async (_attempt) => {
          if (isCancelled(ctx.signal)) {
            return err({ type: 'cancelled', code: 'cancelled', message: 'aborted' });
          }
          if (step.rateLimit) {
            const acquired = await step.rateLimit.acquire(1, ctx.signal);
            if (!acquired) {
              return err({ type: 'cancelled', code: 'rate_limit_aborted', message: 'aborted' });
            }
          }
          return step.run(input, ctx);
        },
        { policy, signal: ctx.signal, globalBudget: budget },
      ),
  );
}

function makeBudget(
  explicit: number | undefined,
  stepCount: number,
  perStageMaxAttempts: number,
): RetryBudget {
  const cap = explicit ?? Math.max(stepCount * perStageMaxAttempts, perStageMaxAttempts);
  return createRetryBudget(cap);
}

function toRunError(
  step: ComposerStep,
  cause: { type: string; code: string; message: string },
  ctx: PipelineContext,
): RunError {
  if (cause.type === 'cancelled') {
    return {
      type: 'cancelled',
      code: 'pipeline_cancelled',
      message: cause.message,
      request_id: ctx.runId,
    };
  }
  const baseFields = {
    code: `${step.kind}_failed`,
    message: cause.message,
    request_id: ctx.runId,
  };
  switch (step.kind) {
    case 'source':
      return { type: 'source_failed', ...baseFields, cause: cause as never };
    case 'process':
    case 'review':
      return { type: 'process_failed', ...baseFields, cause: cause as never };
    case 'serve':
      return { type: 'serve_failed', ...baseFields, cause: cause as never };
    case 'store':
      return { type: 'store_failed', ...baseFields, cause: cause as never };
    default:
      return { type: 'unknown', code: 'composer_unknown_stage', message: cause.message };
  }
}

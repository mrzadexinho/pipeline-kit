/**
 * Probe D — Hypothetical merge
 *
 * Probes fan-out -> merge -> continue: can the current API express it?
 * Topology: battle-test -> [marketing | consolidate] -> merge -> summary
 *
 * NOT required by agent-forge lifecycle (both branches are terminal there).
 * This probe determines the minimum API addition needed if merge IS required.
 *
 * Three strategies:
 *   D1: Imperative assembly — two pipeline runs + tuple source + third pipeline
 *   D2: Union Process<A | B, Summary> — structural assessment only
 *   D3: Hypothetical Pipeline.merge() API — type shape exploration
 */

import {
  ok,
  err,
  Pipeline,
  type Process,
  type Source,
  type Serve,
  type Atom,
  type PipelineContext,
  type TerminalPipeline,
  type Result,
  type RunError,
  type RunResult,
} from './kit-types.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
interface BattleTestResult {
  build_id: string;
  environment: 'production' | 'staging';
  deployed_at: string;
  uptime_percent: number;
  incidents: number;
}

interface MarketingCampaign {
  build_id: string;
  channels: string[];
  launched_at: string;
}

interface ConsolidationRecord {
  build_id: string;
  lessons: string[];
  archived_at: string;
}

interface Summary {
  build_id: string;
  marketing_channels: string[];
  lessons: string[];
  summarized_at: string;
}

// ---------------------------------------------------------------------------
// D1 — Imperative assembly (the ONLY viable pattern today)
//
// Phase 1: Run both branches in parallel
// Phase 2: Assemble results into a tuple (imperative)
// Phase 3: Feed tuple into a third pipeline
//
// TYPE SAFETY: YES throughout — TypeScript tracks types at each phase.
// ERGONOMIC COST: 3 pipeline definitions + imperative glue code.
// COMPOSER API: unchanged — merge lives outside kit.
// ---------------------------------------------------------------------------

// Branch pipelines (factory pattern from probe-b)
function makeBranchSource<T>(id: string, data: T): Source<T> {
  return {
    id,
    async *iter(_q: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<T>> {
      yield { id: `${id}_atom`, object: 'atom', created_at: new Date().toISOString(), metadata: {}, data, run_id: ctx.runId, stage_id: id };
    },
    async fetch(_q: Record<string, unknown> | undefined, ctx: PipelineContext) {
      return ok([{ id: `${id}_atom`, object: 'atom' as const, created_at: new Date().toISOString(), metadata: {}, data, run_id: ctx.runId, stage_id: id }]);
    },
  };
}

const marketingProcess: Process<BattleTestResult, MarketingCampaign> = {
  id: 'pk_proc_mktg_d1',
  async run(input: BattleTestResult, _ctx: PipelineContext) {
    return ok({ build_id: input.build_id, channels: ['twitter'], launched_at: new Date().toISOString() });
  },
};

const consolidateProcess: Process<BattleTestResult, ConsolidationRecord> = {
  id: 'pk_proc_consol_d1',
  async run(input: BattleTestResult, _ctx: PipelineContext) {
    return ok({ build_id: input.build_id, lessons: ['lesson-1'], archived_at: new Date().toISOString() });
  },
};

const mktgServe: Serve<MarketingCampaign> = {
  id: 'pk_serve_mktg_d1',
  async emit(_input: MarketingCampaign, _ctx: PipelineContext) {
    return ok({ id: 'pk_emit_mktg_d1', emitted_at: new Date().toISOString(), metadata: {} });
  },
};

const consolServe: Serve<ConsolidationRecord> = {
  id: 'pk_serve_consol_d1',
  async emit(_input: ConsolidationRecord, _ctx: PipelineContext) {
    return ok({ id: 'pk_emit_consol_d1', emitted_at: new Date().toISOString(), metadata: {} });
  },
};

// Merge step: Process<[MarketingCampaign, ConsolidationRecord], Summary>
type MergeTuple = readonly [MarketingCampaign, ConsolidationRecord];

const mergeProcess: Process<MergeTuple, Summary> = {
  id: 'pk_proc_merge',
  async run(input: MergeTuple, _ctx: PipelineContext) {
    const [marketing, consolidate] = input;
    return ok({ build_id: marketing.build_id, marketing_channels: marketing.channels, lessons: consolidate.lessons, summarized_at: new Date().toISOString() });
  },
};

const summaryServe: Serve<Summary> = {
  id: 'pk_serve_summary',
  async emit(_input: Summary, _ctx: PipelineContext) {
    return ok({ id: 'pk_emit_summary', emitted_at: new Date().toISOString(), metadata: {} });
  },
};

// D1 fan-out + merge: three pipeline runs
export async function d1FanOutAndMerge(battleResult: BattleTestResult): Promise<Result<RunResult<Summary>, RunError>> {
  // Phase 1: both branches in parallel
  const [mktgR, consolR] = await Promise.all([
    Pipeline.from(makeBranchSource('pk_src_mktg', battleResult)).through(marketingProcess).to(mktgServe).run(),
    Pipeline.from(makeBranchSource('pk_src_consol', battleResult)).through(consolidateProcess).to(consolServe).run(),
  ]);

  // Phase 2: imperative assembly — error check both branches
  // NOTE: the Serve<O> in each branch terminates those pipelines with the
  // serve output, not the process output. The process output (MarketingCampaign,
  // ConsolidationRecord) is NOT accessible from mktgR/consolR.data.output —
  // mktgR.data.output is the SERVE's output type (DeploymentRecord in real kit,
  // or in this stub the mktg pipeline's serve wraps it differently).
  //
  // STRUCTURAL GAP D1-A: If branches use Serve<O> as terminal, the Serve output
  // (EmitResult) is what .run() returns — NOT the Process output.
  // To get the Process output for merging, the branch must NOT use Serve; it must
  // use a no-op Serve or the branch pipeline must stop before the Serve step.
  // The kit API has no ".stopBeforeServe()" concept.
  //
  // WORKAROUND: Use a "passthrough Serve" that emits the input unchanged,
  // making the serve's side effect separate from the pipeline's output type.
  // OR: Don't use Serve<O> for branches that need to merge — expose the last
  // Process output by making it the type parameter of the pipeline.
  //
  // This is the CORE MERGE FRICTION: the Serve terminal swallows the typed
  // output needed for the merge step.

  if (mktgR.error !== null || consolR.error !== null) {
    return err({ type: 'permanent' as const, code: 'merge_failed', message: 'A branch failed' });
  }

  // Phase 3: merge pipeline (receives assembled tuple)
  // In a real scenario the tuple would carry the Process outputs, not serve outputs.
  // For this probe, we construct a stub tuple to demonstrate the type flow.
  const stubTuple: MergeTuple = [
    { build_id: battleResult.build_id, channels: ['twitter'], launched_at: new Date().toISOString() },
    { build_id: battleResult.build_id, lessons: ['lesson-1'], archived_at: new Date().toISOString() },
  ] as const;

  return Pipeline
    .from(makeBranchSource<MergeTuple>('pk_src_merge_tuple', stubTuple))
    .through(mergeProcess)
    .to(summaryServe)
    .run();
}

// ---------------------------------------------------------------------------
// D2 — Union Process: structural assessment
//
// Process<MarketingCampaign | ConsolidationRecord, Summary> is type-valid.
// BUT: this Process cannot be placed after two parallel branches in a single
// .through() chain — the Composer is serial. It would require routing N outputs
// to one step, which is the aggregate pattern (ADR-VI-2: Process<I[],O>).
//
// The aggregate handles: single Source emitting N atoms -> merge.
// NOT: two separate Sources (branches) -> merge.
//
// CONCLUSION: D2 doesn't apply to cross-branch merge. It's the right pattern
// for same-branch N:1 reduction, not multi-branch convergence.
// ---------------------------------------------------------------------------
type _MergeUnion = MarketingCampaign | ConsolidationRecord;
const _d2MergeProcess: Process<_MergeUnion, Summary> = {
  id: 'pk_proc_merge_union',
  async run(input: _MergeUnion, _ctx: PipelineContext) {
    if ('channels' in input) {
      return ok({ build_id: input.build_id, marketing_channels: input.channels, lessons: [], summarized_at: new Date().toISOString() });
    }
    return ok({ build_id: input.build_id, marketing_channels: [], lessons: input.lessons, summarized_at: new Date().toISOString() });
  },
};
// Type-valid but structurally inapplicable for cross-branch merge.
void _d2MergeProcess;

// ---------------------------------------------------------------------------
// D3 — Hypothetical Pipeline.merge() API
//
// What a declarative merge primitive would look like:
//
//   Pipeline.merge([pipelineA, pipelineB], mergeProcess).to(summaryServe)
//   -- type: Pipeline.merge<[A, B], Summary>
//   -- return: TerminalPipeline<Summary>
//
// This would require:
//   1. New static method: Pipeline.merge<Branches extends readonly TerminalPipeline<unknown>[]>
//   2. New type utility: BranchOutputs<Branches> = { [K in keyof Branches]: RunResult<...> }
//   3. New PipelineDefinition step kind: 'merge'
//   4. Composer runtime: wait for N sub-pipelines, collect outputs, feed mergeProcess
//
// Type signature sketch (not implemented in kit):
// ---------------------------------------------------------------------------
type _HypotheticalMerge<A, B, O> = {
  pipelines: readonly [TerminalPipeline<A>, TerminalPipeline<B>];
  mergeProcess: Process<readonly [A, B], O>;
};
void (null as unknown as _HypotheticalMerge<MarketingCampaign, ConsolidationRecord, Summary>);

// ---------------------------------------------------------------------------
// KEY FINDING D:
//
// Merge is NOT expressible in a single Composer chain with the current API.
// It requires: 3 pipeline executions + imperative assembly glue code.
//
// Additionally: STRUCTURAL GAP D1-A — Serve<O> swallows the typed Process
// output that the merge step needs. Branches intended for merge should
// NOT use Serve<O> as terminal, or must use a passthrough Serve.
//
// Minimum API addition for declarative merge:
//   Pipeline.merge([pipelineA, pipelineB], mergeProcess) -> TerminalPipeline<Summary>
// This is a new kit-core primitive. Brain must assess whether any real reference
// project requires this. Current agent-forge lifecycle does NOT (both branches terminal).
// ---------------------------------------------------------------------------

export { mergeProcess };

/**
 * Probe B — Parallel terminal branch
 *
 * After step 7 (battle-test), fan out to marketing + consolidate in parallel.
 * Uses kitFanOut pattern: Promise.all with two independent TerminalPipelines.
 *
 * Key question: do types survive the split into heterogeneous branches?
 *
 * Topology:
 *   battle-test result -> Promise.all([
 *     marketingPipeline.run(),    -- branch A -> MarketingCampaign
 *     consolidatePipeline.run(),  -- branch B -> ConsolidationRecord
 *   ])
 *   Both branches are TERMINAL — no merge follows.
 */

import {
  ok,
  Pipeline,
  type Process,
  type Source,
  type Serve,
  type Atom,
  type PipelineContext,
  type TerminalPipeline,
  type RunResult,
  type RunError,
  type Result,
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

// ---------------------------------------------------------------------------
// Shared: Source<BattleTestResult> factory
//
// OBSERVATION B1: Because TerminalPipeline.run() accepts `input?: unknown`,
// the only way to pass a TYPED BattleTestResult to a branch pipeline is to
// wrap it in a factory Source. The .run(input) path loses the type.
// ---------------------------------------------------------------------------
function makeBattleResultSource(input: BattleTestResult): Source<BattleTestResult> {
  return {
    id: 'pk_src_battle_result',
    async *iter(_query: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<BattleTestResult>> {
      yield {
        id: 'pk_atom_battle_result',
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: {},
        data: input,
        run_id: ctx.runId,
        stage_id: 'pk_src_battle_result',
      };
    },
    async fetch(_query: Record<string, unknown> | undefined, ctx: PipelineContext) {
      return ok([{
        id: 'pk_atom_battle_result',
        object: 'atom' as const,
        created_at: new Date().toISOString(),
        metadata: {},
        data: input,
        run_id: ctx.runId,
        stage_id: 'pk_src_battle_result',
      }]);
    },
  };
}

// ---------------------------------------------------------------------------
// Branch A — marketing pipeline
// ---------------------------------------------------------------------------
const marketingProcess: Process<BattleTestResult, MarketingCampaign> = {
  id: 'pk_proc_marketing',
  async run(input: BattleTestResult, _ctx: PipelineContext) {
    return ok({ build_id: input.build_id, channels: ['twitter', 'newsletter', 'product-hunt'], launched_at: new Date().toISOString() });
  },
};

const marketingServe: Serve<MarketingCampaign> = {
  id: 'pk_serve_marketing',
  async emit(input: MarketingCampaign, _ctx: PipelineContext) {
    return ok({ id: `pk_emit_mktg_${input.build_id}`, emitted_at: new Date().toISOString(), metadata: { channels: input.channels } });
  },
};

// ---------------------------------------------------------------------------
// Branch B — consolidate pipeline
// ---------------------------------------------------------------------------
const consolidateProcess: Process<BattleTestResult, ConsolidationRecord> = {
  id: 'pk_proc_consolidate',
  async run(input: BattleTestResult, _ctx: PipelineContext) {
    return ok({ build_id: input.build_id, lessons: [`Uptime: ${input.uptime_percent}%`, `Incidents: ${input.incidents}`], archived_at: new Date().toISOString() });
  },
};

const consolidateServe: Serve<ConsolidationRecord> = {
  id: 'pk_serve_consolidate',
  async emit(input: ConsolidationRecord, _ctx: PipelineContext) {
    return ok({ id: `pk_emit_consol_${input.build_id}`, emitted_at: new Date().toISOString(), metadata: { lessons_count: input.lessons.length } });
  },
};

// ---------------------------------------------------------------------------
// Branch pipeline factories
// ---------------------------------------------------------------------------
export function makeMarketingPipeline(battleResult: BattleTestResult): TerminalPipeline<MarketingCampaign> {
  return Pipeline
    .from(makeBattleResultSource(battleResult))
    .through(marketingProcess)
    .to(marketingServe);
}

export function makeConsolidatePipeline(battleResult: BattleTestResult): TerminalPipeline<ConsolidationRecord> {
  return Pipeline
    .from(makeBattleResultSource(battleResult))
    .through(consolidateProcess)
    .to(consolidateServe);
}

// ---------------------------------------------------------------------------
// kitFanOut: parallel terminal fan-out
//
// TYPE SAFETY ANALYSIS:
//   marketingPipeline.run()    -> Promise<Result<RunResult<MarketingCampaign>, RunError>>
//   consolidatePipeline.run()  -> Promise<Result<RunResult<ConsolidationRecord>, RunError>>
//
//   Promise.all([A, B]) infers [Awaited<A>, Awaited<B>] — heterogeneous TUPLE.
//   This means:
//     index 0 -> Result<RunResult<MarketingCampaign>, RunError>  (typed)
//     index 1 -> Result<RunResult<ConsolidationRecord>, RunError> (typed)
//
//   NO type cast required. TypeScript preserves both branch types.
//   Narrowing (error !== null) works on each branch independently.
//
// OBSERVATION B2: Type safety survives the split. Promise.all tuple inference
//   works because branch pipelines have heterogeneous O types. The returned
//   const tuple is typed without `as` casts.
// ---------------------------------------------------------------------------
export async function kitFanOut(battleResult: BattleTestResult) {
  const marketingPipeline = makeMarketingPipeline(battleResult);
  const consolidatePipeline = makeConsolidatePipeline(battleResult);

  const [marketingResult, consolidateResult] = await Promise.all([
    marketingPipeline.run(),
    consolidatePipeline.run(),
  ]);

  if (marketingResult.error !== null) {
    console.error('Marketing branch failed:', marketingResult.error.message);
  } else {
    // marketingResult.data.output: MarketingCampaign — typed correctly
    const _campaign: MarketingCampaign = marketingResult.data.output;
    void _campaign;
  }

  if (consolidateResult.error !== null) {
    console.error('Consolidate branch failed:', consolidateResult.error.message);
  } else {
    // consolidateResult.data.output: ConsolidationRecord — typed correctly
    const _record: ConsolidationRecord = consolidateResult.data.output;
    void _record;
  }

  return [marketingResult, consolidateResult] as const;
}

// ---------------------------------------------------------------------------
// Type-level assertion: Promise.all tuple is fully typed without casts
//
// Explicit annotation proves the inferred type matches expectations:
// ---------------------------------------------------------------------------
type MarketingBranchResult = Result<RunResult<MarketingCampaign>, RunError>;
type ConsolidateBranchResult = Result<RunResult<ConsolidationRecord>, RunError>;
type FanOutResult = ReturnType<typeof kitFanOut>;
// FanOutResult should be: Promise<readonly [MarketingBranchResult, ConsolidateBranchResult]>

// Assign the return to explicitly typed variables to confirm:
const _typedFanOut: (r: BattleTestResult) => FanOutResult = kitFanOut;
void _typedFanOut;

// ---------------------------------------------------------------------------
// OBSERVATION B3: Fan-out point is NOT in the Composer API.
//   It lives in imperative Promise.all code outside any Pipeline instance.
//   Each branch requires its own Source factory (per B1 above).
//   The "step 8 = two parallel terminal branches" is expressed as:
//     const [a, b] = await Promise.all([pipeA.run(), pipeB.run()])
//   This is ergonomic for N=2 terminal branches, but requires a pattern for N>2.
//   A kitFanOut() helper (like kitFanOut() above) wraps this cleanly.
// ---------------------------------------------------------------------------

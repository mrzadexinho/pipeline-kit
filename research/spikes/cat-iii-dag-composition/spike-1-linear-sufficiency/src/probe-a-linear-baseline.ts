/**
 * Probe A — Linear baseline
 *
 * Express agent-forge Studio steps 1-7 as a single Composer chain.
 * Verifies TypeScript generics flow through the full chain without breaks.
 *
 * Topology: research -> demand-gate (inline) -> plan -> execute -> validate -> deploy -> battle-test
 *
 * Type check: tsc --noEmit (from spike-1-linear-sufficiency/)
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
} from './kit-types.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
interface ResearchOutput {
  topic: string;
  sources: string[];
  summary: string;
}

interface DemandSignal {
  topic: string;
  sources: string[];
  summary: string;
  demand_score: number;
}

interface Plan {
  demand_score: number;
  milestones: string[];
  estimated_days: number;
}

interface ExecutionResult {
  milestones: string[];
  artifacts: string[];
  build_id: string;
}

interface ValidationReport {
  build_id: string;
  artifacts: string[];
  passed: boolean;
  findings: string[];
}

interface DeploymentRecord {
  build_id: string;
  artifacts: string[];
  environment: 'production' | 'staging';
  deployed_at: string;
}

// ---------------------------------------------------------------------------
// Step 1 — Source: research
// ---------------------------------------------------------------------------
const researchSource: Source<ResearchOutput> = {
  id: 'pk_src_research',
  async *iter(_query: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<ResearchOutput>> {
    yield {
      id: 'pk_atom_research_001',
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: {},
      data: { topic: 'ai-agents', sources: ['arxiv', 'github'], summary: 'Agent survey' },
      run_id: ctx.runId,
      stage_id: 'pk_src_research',
    };
  },
  async fetch(_query: Record<string, unknown> | undefined, ctx: PipelineContext) {
    return ok([
      {
        id: 'pk_atom_research_001',
        object: 'atom' as const,
        created_at: new Date().toISOString(),
        metadata: {},
        data: { topic: 'ai-agents', sources: ['arxiv', 'github'], summary: 'Agent survey' },
        run_id: ctx.runId,
        stage_id: 'pk_src_research',
      },
    ]);
  },
};

// ---------------------------------------------------------------------------
// Step 2 — Process: demand-gate (inline; gate = Process<I,DemandSignal>)
// Note: gate proper (ADR-VI-1) is Process<I,I>. Here we merge gate + enrich
// for baseline probe. Probe C isolates the pure gate pattern.
// ---------------------------------------------------------------------------
const demandGateProcess: Process<ResearchOutput, DemandSignal> = {
  id: 'pk_proc_demand_gate',
  async run(input: ResearchOutput, _ctx: PipelineContext) {
    const demand_score = input.sources.length * 50;
    if (demand_score < 50) {
      return err({ type: 'permanent' as const, code: 'gate_held', message: 'Demand score below threshold' });
    }
    return ok({ ...input, demand_score });
  },
};

// ---------------------------------------------------------------------------
// Step 3 — Process: plan
// ---------------------------------------------------------------------------
const planProcess: Process<DemandSignal, Plan> = {
  id: 'pk_proc_plan',
  async run(input: DemandSignal, _ctx: PipelineContext) {
    return ok({ demand_score: input.demand_score, milestones: ['v0.1', 'v0.2', 'v1.0'], estimated_days: 90 });
  },
};

// ---------------------------------------------------------------------------
// Step 4 — Process: execute
// ---------------------------------------------------------------------------
const executeProcess: Process<Plan, ExecutionResult> = {
  id: 'pk_proc_execute',
  async run(_input: Plan, _ctx: PipelineContext) {
    return ok({ milestones: ['v0.1'], artifacts: ['dist/index.js'], build_id: 'build_001' });
  },
};

// ---------------------------------------------------------------------------
// Step 5 — Process: validate
// ---------------------------------------------------------------------------
const validateProcess: Process<ExecutionResult, ValidationReport> = {
  id: 'pk_proc_validate',
  async run(input: ExecutionResult, _ctx: PipelineContext) {
    return ok({ build_id: input.build_id, artifacts: input.artifacts, passed: true, findings: [] });
  },
};

// ---------------------------------------------------------------------------
// Step 6 — Process: deploy
// ---------------------------------------------------------------------------
const deployProcess: Process<ValidationReport, DeploymentRecord> = {
  id: 'pk_proc_deploy',
  async run(input: ValidationReport, _ctx: PipelineContext) {
    if (!input.passed) {
      return err({ type: 'permanent' as const, code: 'validation_failed', message: 'Cannot deploy' });
    }
    return ok({ build_id: input.build_id, artifacts: input.artifacts, environment: 'production' as const, deployed_at: new Date().toISOString() });
  },
};

// ---------------------------------------------------------------------------
// Step 7 — Serve: battle-test (terminal for steps 1-7)
// ---------------------------------------------------------------------------
const battleTestServe: Serve<DeploymentRecord> = {
  id: 'pk_serve_battle_test',
  async emit(input: DeploymentRecord, _ctx: PipelineContext) {
    return ok({ id: `pk_emit_battle_${input.build_id}`, emitted_at: new Date().toISOString(), metadata: {} });
  },
};

// ---------------------------------------------------------------------------
// Composer chain: steps 1-7
//
// TypeScript must propagate the generic parameter through each .through() call:
//   Pipeline.from<ResearchOutput>     -- Source<ResearchOutput>
//   .through<DemandSignal>            -- Process<ResearchOutput, DemandSignal>
//   .through<Plan>                    -- Process<DemandSignal, Plan>
//   .through<ExecutionResult>         -- Process<Plan, ExecutionResult>
//   .through<ValidationReport>        -- Process<ExecutionResult, ValidationReport>
//   .through<DeploymentRecord>        -- Process<ValidationReport, DeploymentRecord>
//   .to                               -- Serve<DeploymentRecord>
//
// If any Process<I,O> mismatches its predecessor's O, tsc will emit an error.
// ---------------------------------------------------------------------------
export const studioLinearPipeline: TerminalPipeline<DeploymentRecord> = Pipeline
  .from(researchSource)
  .through(demandGateProcess)
  .through(planProcess)
  .through(executeProcess)
  .through(validateProcess)
  .through(deployProcess)
  .to(battleTestServe);

// Structural assertion: type must be TerminalPipeline<DeploymentRecord>
// If generics break anywhere above, tsc errors here.
// Uses satisfies to confirm the type without assignment widening issues.
const _typedPipeline: TerminalPipeline<DeploymentRecord> = studioLinearPipeline;
void _typedPipeline;

// FINDING: 7-step linear chain compiles without type errors.
// Generic threading through .through().through()...to() is intact.
// Each Process<I,O> constrains the next .through()'s input type at compile time.

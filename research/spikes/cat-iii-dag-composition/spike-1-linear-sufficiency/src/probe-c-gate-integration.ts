/**
 * Probe C — Gate integration (isolated)
 *
 * Express step 2 (demand-gate) as a pure Process<I,I> gate per ADR-VI-1.
 * Verifies it composes inline in the .through() chain with correct
 * Result<T,E> error propagation.
 *
 * Gate contract (ADR-VI-1):
 *   Process<I,I> returns:
 *     ok(input)                                         -- passes, value unchanged
 *     err({ type: 'permanent', code: 'gate_held' })     -- soft hold
 *     err({ type: 'permanent', code: 'gate_rejected' }) -- hard rejection
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
} from './kit-types.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
interface ResearchOutput {
  topic: string;
  sources: string[];
  summary: string;
}

interface DemandSignal extends ResearchOutput {
  demand_score: number;
}

interface Plan {
  demand_score: number;
  milestones: string[];
  estimated_days: number;
}

// ---------------------------------------------------------------------------
// Gate: Process<ResearchOutput, ResearchOutput>
//
// ADR-VI-1 key property: output type === input type.
// The gate is TRANSPARENT to the type chain — O does not change.
//
// Typing analysis:
//   Pipeline.from<ResearchOutput>
//   .through(gate: Process<ResearchOutput, ResearchOutput>)
//   -> SourcePipeline<ResearchOutput>  -- same O, gate invisible to type chain
//   .through(enrich: Process<ResearchOutput, DemandSignal>)
//   -> SourcePipeline<DemandSignal>
//
// tsc confirms: gate does NOT change the SourcePipeline's type parameter.
// ---------------------------------------------------------------------------
const demandGate: Process<ResearchOutput, ResearchOutput> = {
  id: 'pk_proc_demand_gate',
  async run(input: ResearchOutput, _ctx: PipelineContext) {
    const demand_score = input.sources.length * 50;

    if (demand_score === 0) {
      return err({ type: 'permanent' as const, code: 'gate_rejected', message: 'Zero sources: demand insufficient' });
    }
    if (demand_score < 50) {
      return err({ type: 'permanent' as const, code: 'gate_held', message: `Demand score ${demand_score} below threshold 50` });
    }

    return ok(input); // pass: return input unchanged
  },
};

// Downstream enrichment (separate Process after gate)
const demandEnrichProcess: Process<ResearchOutput, DemandSignal> = {
  id: 'pk_proc_demand_enrich',
  async run(input: ResearchOutput, _ctx: PipelineContext) {
    return ok({ ...input, demand_score: input.sources.length * 50 });
  },
};

const planProcess: Process<DemandSignal, Plan> = {
  id: 'pk_proc_plan_c',
  async run(input: DemandSignal, _ctx: PipelineContext) {
    return ok({ demand_score: input.demand_score, milestones: ['v0.1'], estimated_days: 30 });
  },
};

const planServe: Serve<Plan> = {
  id: 'pk_serve_plan_c',
  async emit(_input: Plan, _ctx: PipelineContext) {
    return ok({ id: 'pk_emit_plan', emitted_at: new Date().toISOString(), metadata: {} });
  },
};

const researchSource: Source<ResearchOutput> = {
  id: 'pk_src_research_c',
  async *iter(_q: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<ResearchOutput>> {
    yield { id: 'pk_atom_r', object: 'atom', created_at: new Date().toISOString(), metadata: {}, data: { topic: 'test', sources: ['a', 'b'], summary: 'ok' }, run_id: ctx.runId, stage_id: 'pk_src_research_c' };
  },
  async fetch(_q: Record<string, unknown> | undefined, ctx: PipelineContext) {
    return ok([{ id: 'pk_atom_r', object: 'atom' as const, created_at: new Date().toISOString(), metadata: {}, data: { topic: 'test', sources: ['a', 'b'], summary: 'ok' }, run_id: ctx.runId, stage_id: 'pk_src_research_c' }]);
  },
};

// ---------------------------------------------------------------------------
// Composer chain with inline gate
//
// .through(demandGate)       -- Process<ResearchOutput, ResearchOutput>
//   still SourcePipeline<ResearchOutput>  <- type unchanged
// .through(demandEnrichProcess)  -- Process<ResearchOutput, DemandSignal>
//   SourcePipeline<DemandSignal>
//
// Error propagation: if demandGate returns err(), Composer short-circuits.
// demandEnrichProcess and planProcess DO NOT run.
// The RunError carries gate's code ('gate_held' | 'gate_rejected').
// ---------------------------------------------------------------------------
export const gatePipeline = Pipeline
  .from(researchSource)
  .through(demandGate)           // Gate: Process<ResearchOutput, ResearchOutput>
  .through(demandEnrichProcess)  // Enrich: Process<ResearchOutput, DemandSignal>
  .through(planProcess)          // Plan: Process<DemandSignal, Plan>
  .to(planServe);                // Serve: Serve<Plan>

// ---------------------------------------------------------------------------
// Type assertions
// ---------------------------------------------------------------------------

// 1. Gate is assignable to Process<ResearchOutput, ResearchOutput>
const _gateTypeCheck: Process<ResearchOutput, ResearchOutput> = demandGate;
void _gateTypeCheck;

// 2. Gate does NOT change SourcePipeline's type parameter.
//    Verified by the chain above: after .through(demandGate), the pipeline
//    accepts demandEnrichProcess: Process<ResearchOutput, DemandSignal>.
//    If gate changed O to something else, demandEnrichProcess would fail to typecheck.

// FINDING C1: Gate composes inline as Process<I,I> with zero API changes.
// FINDING C2: Gate is invisible to the type chain — O unchanged across gate.
// FINDING C3: Gate error propagation is via ProcessError — same as any Process<I,O>.
//   The specific codes ('gate_held', 'gate_rejected') are CONVENTIONS, not new error types.
// FINDING C4: Downstream steps are unreachable when gate returns err() —
//   this is standard Composer short-circuit behavior, not gate-specific.

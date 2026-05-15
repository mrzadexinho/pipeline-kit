/**
 * Probe E — Back-edge / loop
 *
 * Can the Composer support back-edges (cycles)?
 * Use case: validate (step 5) loops back to execute (step 4) on failure.
 *
 * Topology:
 *   execute -> validate
 *              |-- ok({passed: true})  -> deploy (continue)
 *              |-- ok({passed: false}) -> loop back to execute
 *
 * Three strategies:
 *   E1: External loop — imperative while() in application code
 *   E2: Process that internally retries — loop inside run()
 *   E3: Compiler-level proof that Composer has no back-edge API
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
  type Result,
  type RunError,
  type RunResult,
} from './kit-types.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
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
  deployed_at: string;
}

// ---------------------------------------------------------------------------
// Stage stubs
// ---------------------------------------------------------------------------
const executeProcess: Process<ExecutionResult, ExecutionResult> = {
  id: 'pk_proc_execute_e1',
  async run(input: ExecutionResult, _ctx: PipelineContext) {
    return ok({ ...input, build_id: `build_${Date.now()}` });
  },
};

const validateProcess: Process<ExecutionResult, ValidationReport> = {
  id: 'pk_proc_validate_e1',
  async run(input: ExecutionResult, _ctx: PipelineContext) {
    const passed = Math.random() > 0.3;
    return ok({ build_id: input.build_id, artifacts: input.artifacts, passed, findings: passed ? [] : ['lint-error'] });
  },
};

const deployServe: Serve<ExecutionResult> = {
  id: 'pk_serve_deploy_e1',
  async emit(input: ExecutionResult, _ctx: PipelineContext) {
    return ok({ id: `pk_emit_deploy_${input.build_id}`, emitted_at: new Date().toISOString(), metadata: {} });
  },
};

const validateServe: Serve<ValidationReport> = {
  id: 'pk_serve_validate_e1',
  async emit(input: ValidationReport, _ctx: PipelineContext) {
    return ok({ id: `pk_emit_validate_${input.build_id}`, emitted_at: new Date().toISOString(), metadata: { passed: input.passed } });
  },
};

function makeExecSource(input: ExecutionResult): Source<ExecutionResult> {
  return {
    id: 'pk_src_exec_e1',
    async *iter(_q: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<ExecutionResult>> {
      yield { id: 'pk_atom_exec', object: 'atom', created_at: new Date().toISOString(), metadata: {}, data: input, run_id: ctx.runId, stage_id: 'pk_src_exec_e1' };
    },
    async fetch(_q: Record<string, unknown> | undefined, ctx: PipelineContext) {
      return ok([{ id: 'pk_atom_exec', object: 'atom' as const, created_at: new Date().toISOString(), metadata: {}, data: input, run_id: ctx.runId, stage_id: 'pk_src_exec_e1' }]);
    },
  };
}

// ---------------------------------------------------------------------------
// E1 — External loop (only viable strategy)
//
// Caller drives the iteration. Composer is stateless — no back-edge support.
//
// CRITICAL GAP E1: When execute and validate are in the SAME chain:
//   Pipeline.from(execSource).through(executeProcess).through(validateProcess).to(serve)
//   .run() -> Result<RunResult<ValidationReport>, RunError>
//
//   The ExecutionResult (executeProcess output) is NOT accessible to the caller.
//   The caller cannot feed it back to the next iteration's source.
//
// SOLUTION: Split at the back-edge. Two separate pipelines:
//   executePipeline: from(source) -> through(execute) -> to(passServe)  -> RunResult<ExecutionResult>
//   validatePipeline: from(execResultSource) -> through(validate) -> to(deployServe) -> RunResult<ValidationReport>
//
// Then loop:
//   while (attempt < maxRetries) {
//     const execResult = await executePipeline.run()
//     const validateResult = await validatePipeline.run(execResult.data.output)
//     if (validateResult.data.output.passed) break
//     // loop: execResult feeds next iteration
//   }
//
// TYPE SAFETY: YES — each pipeline returns its typed output.
// ERGONOMIC COST: 2 separate pipelines instead of 1 chain for the back-edge.
// ---------------------------------------------------------------------------
const passServe: Serve<ExecutionResult> = {
  id: 'pk_serve_pass_exec',
  async emit(input: ExecutionResult, _ctx: PipelineContext) {
    return ok({ id: 'pk_emit_pass', emitted_at: new Date().toISOString(), metadata: { build_id: input.build_id } });
  },
};

function makeValidateSource(input: ExecutionResult): Source<ExecutionResult> {
  return {
    id: 'pk_src_validate_e1',
    async *iter(_q: Record<string, unknown> | undefined, ctx: PipelineContext): AsyncIterable<Atom<ExecutionResult>> {
      yield { id: 'pk_atom_validate', object: 'atom', created_at: new Date().toISOString(), metadata: {}, data: input, run_id: ctx.runId, stage_id: 'pk_src_validate_e1' };
    },
    async fetch(_q: Record<string, unknown> | undefined, ctx: PipelineContext) {
      return ok([{ id: 'pk_atom_validate', object: 'atom' as const, created_at: new Date().toISOString(), metadata: {}, data: input, run_id: ctx.runId, stage_id: 'pk_src_validate_e1' }]);
    },
  };
}

// Split pipeline approach
export async function executeValidateLoop(
  initial: ExecutionResult,
  maxRetries = 3,
): Promise<Result<RunResult<ValidationReport>, RunError>> {
  let currentInput = initial;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Execute pipeline: Source -> Process<ExecutionResult, ExecutionResult> -> Serve
    const execResult = await Pipeline
      .from(makeExecSource(currentInput))
      .through(executeProcess)
      .to(passServe)
      .run();

    if (execResult.error !== null) {
      return execResult;
    }

    // STRUCTURAL GAP E1: execResult.data.output is typed by the SERVE (passServe emits EmitResult).
    // In the real kit, .to(serve).run() returns RunResult<ExecutionResult> where O is the serve's
    // INPUT type (same as the last process output). This is the passthrough serve pattern.
    // For this probe stub, we work with the known ExecutionResult directly.
    const executedInput: ExecutionResult = currentInput; // stub for probe

    // Validate pipeline: Source -> Process<ExecutionResult, ValidationReport> -> Serve
    const validateSource = makeValidateSource(executedInput);
    const validateResult = await Pipeline
      .from(validateSource)
      .through(validateProcess)
      .to(validateServe) // validateServe accepts ValidationReport
      .run();

    if (validateResult.error !== null) {
      return validateResult as Result<RunResult<ValidationReport>, RunError>;
    }

    // Check if validation passed — requires accessing the ValidationReport from the pipeline
    // SAME GAP: validateResult.data.output is typed by deployServe, not validateProcess.
    // In a real implementation, a ValidationReport-typed Serve would be used.

    // For structural purposes, break on first success (we can't read .passed without
    // a ValidationReport-typed serve output):
    return validateResult as Result<RunResult<ValidationReport>, RunError>;
  }

  return err({ type: 'permanent' as const, code: 'max_retries_exhausted', message: `Failed after ${maxRetries} attempts` });
}

// ---------------------------------------------------------------------------
// E2 — Process that internally retries (anti-pattern demonstration)
//
// Loop inside Process.run() — violates stage separation.
// execute logic duplicated inside validate.
// VERDICT: rejected, not a kit pattern.
// ---------------------------------------------------------------------------
const _executeAndValidateProcess: Process<ExecutionResult, ValidationReport> = {
  id: 'pk_proc_execute_and_validate_e2',
  async run(input: ExecutionResult, _ctx: PipelineContext) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const executed: ExecutionResult = { ...input, build_id: `build_iter_${attempt}` };
      const passed = Math.random() > 0.3;
      if (passed) {
        return ok({ build_id: executed.build_id, artifacts: executed.artifacts, passed: true, findings: [] });
      }
    }
    return err({ type: 'permanent' as const, code: 'max_internal_retries', message: 'Internal loop exhausted' });
  },
};
void _executeAndValidateProcess; // type-valid but anti-pattern

// ---------------------------------------------------------------------------
// E3 — Compiler-level proof: Composer has no back-edge API
//
// SourcePipeline<O> interface methods:
//   .through<Out>(process: Process<O, Out>): SourcePipeline<Out>  -- forward only
//   .store(store: Store<O>): SourcePipeline<O>
//   .review(reviewable: Reviewable<O>): SourcePipeline<O>
//   .to(serve: Serve<O>): TerminalPipeline<O>
//   .describe(): PipelineDefinition
//
// PipelineDefinition.steps is ReadonlyArray<PipelineStep> — flat linear list.
// No step kind supports back-pointer or cycle.
//
// A loop-aware variant would require:
//   1. New PipelineStep union: { kind: 'loop'; condition: ...; backToStepIndex: number }
//   2. New SourcePipeline<O> method: .loopBack(condition, targetStepId)
//   3. Composer runtime: detect loop condition, replay from target step
//
// This is 3 new API surfaces. NONE exist today.
// ---------------------------------------------------------------------------

// Hypothetical loop step type (for documentation only):
type _HypotheticalLoopStep = {
  kind: 'loop';
  condition: (output: unknown) => boolean;
  backToStepId: string;
  maxIterations: number;
};
void (null as unknown as _HypotheticalLoopStep);

// ---------------------------------------------------------------------------
// KEY FINDINGS for E:
//
// E1: Composer has NO back-edge. Completely linear execution.
// E2: External loop (split-pipeline) works but has a critical ergonomic gap:
//   intermediate stage outputs are accessible ONLY if the Serve at the split
//   point is a passthrough that returns the Process output type.
//   The current real kit Serve returns EmitResult from emit(), not the input type.
//   TerminalPipeline<O>.run() returns RunResult<O> where O is tied to the Serve's
//   input (not its emit return type). This is actually correct — O propagates.
//   [PENDING-VERIFY: in real kit, Pipeline.from().through(P).to(S).run() returns
//   RunResult where .output is the Serve's INPUT type, not EmitResult. Verify.]
// E3: Adding loop primitive requires 3 new API surfaces.
// E4: Inngest's retry policy is the natural loop primitive for execute->validate
//   loops — express retry as "on ValidationReport{passed:false}, retry execute step"
//   using kitStep() shim. This avoids a kit-core loop primitive entirely.
// ---------------------------------------------------------------------------

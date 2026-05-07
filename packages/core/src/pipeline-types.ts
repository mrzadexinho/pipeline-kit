import type { PipelineContext } from './context.js';
import type { RunError } from './errors/run.js';
import type { Result } from './result.js';
import type { Reviewable } from './reviewable.js';
import type { Process } from './stages/process.js';
import type { Serve } from './stages/serve.js';
import type { Source } from './stages/source.js';
import type { Store } from './stages/store.js';

export interface RunOptions {
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  context?: Partial<PipelineContext>;
}

export interface RunResult<O> {
  runId: string;
  pipelineId: string;
  output: O;
  atomCount: number;
  duration: number;
  metadata: Record<string, unknown>;
}

export type PipelineStep =
  | { kind: 'source'; source: Source<unknown> }
  | { kind: 'process'; process: Process<unknown, unknown> }
  | { kind: 'store'; store: Store<unknown> }
  | { kind: 'review'; reviewable: Reviewable<unknown> }
  | { kind: 'serve'; serve: Serve<unknown> };

export interface PipelineDefinition {
  pipelineId: string;
  steps: ReadonlyArray<PipelineStep>;
}

export interface SourcePipeline<O> {
  through<Out>(process: Process<O, Out>): SourcePipeline<Out>;
  store(store: Store<O>): SourcePipeline<O>;
  review(reviewable: Reviewable<O>): SourcePipeline<O>;
  to(serve: Serve<O>): TerminalPipeline<O>;
  describe(): PipelineDefinition;
}

export interface TerminalPipeline<O> {
  run(input?: unknown, options?: RunOptions): Promise<Result<RunResult<O>, RunError>>;
  describe(): PipelineDefinition;
}

import { expect, test } from 'tstyche';
import { Pipeline } from '../src/pipeline.js';
import type {
  PipelineDefinition,
  RunOptions,
  RunResult,
  SourcePipeline,
  TerminalPipeline,
} from '../src/pipeline-types.js';
import type { Result } from '../src/result.js';
import type { Reviewable } from '../src/reviewable.js';
import type { Process } from '../src/stages/process.js';
import type { Serve } from '../src/stages/serve.js';
import type { Source } from '../src/stages/source.js';

declare const stringSource: Source<string>;
declare const numberSource: Source<number>;
declare const stringToNumber: Process<string, number>;
declare const stringToString: Process<string, string>;
declare const stringServe: Serve<string>;
declare const numberServe: Serve<number>;
declare const stringReviewable: Reviewable<string>;

test('Pipeline.from infers SourcePipeline output type from Source<O>', () => {
  expect(Pipeline.from(stringSource)).type.toBe<SourcePipeline<string>>();
  expect(Pipeline.from(numberSource)).type.toBe<SourcePipeline<number>>();
});

test('through narrows output type via Process<I, Out>', () => {
  const after = Pipeline.from(stringSource).through(stringToNumber);
  expect(after).type.toBe<SourcePipeline<number>>();
});

test('store preserves output type', () => {
  const after = Pipeline.from(stringSource).through(stringToString);
  expect(after).type.toBe<SourcePipeline<string>>();
});

test('review preserves output type via Reviewable<O>', () => {
  const after = Pipeline.from(stringSource).review(stringReviewable);
  expect(after).type.toBe<SourcePipeline<string>>();
});

test('to(serve) narrows to TerminalPipeline<O>', () => {
  const terminal = Pipeline.from(stringSource).to(stringServe);
  expect(terminal).type.toBe<TerminalPipeline<string>>();
});

test('TerminalPipeline.run returns Promise<Result<RunResult<O>, RunError>>', () => {
  const terminal = Pipeline.from(stringSource).to(stringServe);
  expect(terminal.run()).type.toBe<
    Promise<Result<RunResult<string>, import('../src/errors/run.js').RunError>>
  >();
});

test('describe() returns PipelineDefinition', () => {
  expect(Pipeline.from(stringSource).describe()).type.toBe<PipelineDefinition>();
});

test('chained pipeline narrows correctly through Process → Serve', () => {
  const terminal = Pipeline.from(stringSource).through(stringToNumber).to(numberServe);
  expect(terminal).type.toBe<TerminalPipeline<number>>();
});

test('mismatched generics fail to compile (Process<string, _> on a number Source)', () => {
  expect(Pipeline.from(numberSource)).type.not.toBeAssignableTo<SourcePipeline<string>>();
});

test('Serve type must match SourcePipeline output type', () => {
  type StringPipe = SourcePipeline<string>;
  expect<StringPipe>().type.toBeAssignableTo<{
    to(serve: Serve<string>): TerminalPipeline<string>;
  }>();
});

test('RunOptions has expected shape (assignable to subset)', () => {
  expect<RunOptions>().type.toBeAssignableTo<{
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }>();
});

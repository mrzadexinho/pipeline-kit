import { describe, expectTypeOf, it } from 'vitest';
import type { PipelineContext } from '../src/context.js';
import type { DefinedPipeline, PipelineDefinitionEnriched } from '../src/define-pipeline.js';
import type { AgentProcess, Aggregate, Gate } from '../src/patterns.js';
import type { Process } from '../src/stages/process.js';
import type { UsageAccumulator } from '../src/usage.js';

describe('PipelineContext v1 completeness', () => {
  it('has all v1 fields', () => {
    expectTypeOf<PipelineContext>().toHaveProperty('runId');
    expectTypeOf<PipelineContext>().toHaveProperty('pipelineId');
    expectTypeOf<PipelineContext>().toHaveProperty('attempt');
    expectTypeOf<PipelineContext>().toHaveProperty('metadata');
    expectTypeOf<PipelineContext>().toHaveProperty('signal');
    expectTypeOf<PipelineContext>().toHaveProperty('trace');
    expectTypeOf<PipelineContext>().toHaveProperty('deps');
    expectTypeOf<PipelineContext>().toHaveProperty('usage');
  });

  it('deps is Record<string, unknown>', () => {
    expectTypeOf<PipelineContext['deps']>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
  });

  it('usage is UsageAccumulator', () => {
    expectTypeOf<PipelineContext['usage']>().toMatchTypeOf<UsageAccumulator>();
  });
});

describe('DefinedPipeline generics', () => {
  it('has run and describe methods', () => {
    expectTypeOf<DefinedPipeline<string>>().toHaveProperty('run');
    expectTypeOf<DefinedPipeline<string>>().toHaveProperty('describe');
  });

  it('describe returns PipelineDefinitionEnriched', () => {
    type DescribeReturn = ReturnType<DefinedPipeline<string>['describe']>;
    expectTypeOf<DescribeReturn>().toMatchTypeOf<PipelineDefinitionEnriched>();
  });
});

describe('Pattern type aliases', () => {
  it('Gate<I> = Process<I, I>', () => {
    expectTypeOf<Gate<string>>().toEqualTypeOf<Process<string, string>>();
  });

  it('Aggregate<I, O> = Process<I[], O>', () => {
    expectTypeOf<Aggregate<number, string>>().toEqualTypeOf<Process<number[], string>>();
  });

  it('AgentProcess<I, O> = Process<I, O>', () => {
    expectTypeOf<AgentProcess<string, number>>().toEqualTypeOf<Process<string, number>>();
  });
});

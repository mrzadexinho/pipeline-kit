import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { type ComposerStep, ok, runComposer } from '@idriszade/core';
import fc from 'fast-check';
import { beforeAll, beforeEach, describe, it } from 'vitest';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

describe('OTel property — every stage produces a span', () => {
  beforeEach(() => exporter.reset());

  it('span count is at least equal to stage count for any pipeline length', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (stageCount) => {
        exporter.reset();
        const steps: ComposerStep[] = Array.from({ length: stageCount }, (_, i) => ({
          id: `pk_proc_${i}`,
          kind: 'process',
          async run(input) {
            return ok(input);
          },
        }));
        await runComposer({
          pipelineId: 'pk_pipe_otel_prop',
          steps,
          initialInput: 'in',
        });
        const spans = exporter.getFinishedSpans();
        return spans.length >= stageCount;
      }),
      { numRuns: 10 },
    );
  });

  it('each emitted span has runId/pipelineId/stageId attributes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (stageCount) => {
        exporter.reset();
        const steps: ComposerStep[] = Array.from({ length: stageCount }, (_, i) => ({
          id: `pk_proc_attrs_${i}`,
          kind: 'process',
          async run(input) {
            return ok(input);
          },
        }));
        await runComposer({
          pipelineId: 'pk_pipe_otel_attrs',
          steps,
          initialInput: 'x',
        });
        const spans = exporter.getFinishedSpans();
        return spans.every((s) => {
          const attrs = s.attributes;
          return (
            typeof attrs.runId === 'string' &&
            typeof attrs.pipelineId === 'string' &&
            typeof attrs.stageId === 'string'
          );
        });
      }),
      { numRuns: 10 },
    );
  });
});

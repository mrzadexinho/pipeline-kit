import { describe, expect, it, vi } from 'vitest';
import { definePipeline, type PipelineDefinitionEnriched } from '../src/define-pipeline.js';
import type { TerminalPipeline } from '../src/pipeline-types.js';
import { ok } from '../src/result.js';
import type { Reviewable } from '../src/reviewable.js';
import type { Process } from '../src/stages/process.js';
import type { Serve } from '../src/stages/serve.js';
import type { Source } from '../src/stages/source.js';
import type { Store } from '../src/stages/store.js';

function mockTerminalPipeline(): TerminalPipeline<string> {
  return {
    async run(_input, _options) {
      return ok({
        runId: 'pk_run_test',
        pipelineId: 'pk_pipe_test',
        output: 'result',
        atomCount: 1,
        duration: 100,
        metadata: {},
      });
    },
    describe() {
      return {
        pipelineId: 'pk_pipe_test',
        steps: [
          { kind: 'source' as const, source: { id: 'pk_src_test' } as unknown as Source<unknown> },
          {
            kind: 'process' as const,
            process: { id: 'pk_proc_test' } as unknown as Process<unknown, unknown>,
          },
          { kind: 'serve' as const, serve: { id: 'pk_serve_test' } as unknown as Serve<unknown> },
        ],
      };
    },
  };
}

describe('definePipeline', () => {
  describe('describe() — enriched definition round-trip', () => {
    it('returns the id from opts', () => {
      const pipeline = mockTerminalPipeline();
      const defined = definePipeline({ id: 'pk_pipe_mytest' }, pipeline);
      expect(defined.describe().id).toBe('pk_pipe_mytest');
    });

    it('returns all opts fields in the enriched definition', () => {
      const pipeline = mockTerminalPipeline();
      const defined = definePipeline(
        {
          id: 'pk_pipe_full',
          trigger: { kind: 'cron', expr: '0 * * * *' },
          retry: { maxAttempts: 3 },
          concurrency: { limit: 5, overflow: 'queue' },
          tags: { env: 'production' },
          version: '1.0.0',
        },
        pipeline,
      );

      const enriched: PipelineDefinitionEnriched = defined.describe();
      expect(enriched.id).toBe('pk_pipe_full');
      expect(enriched.trigger).toEqual({ kind: 'cron', expr: '0 * * * *' });
      expect(enriched.retry).toEqual({ maxAttempts: 3 });
      expect(enriched.concurrency).toEqual({ limit: 5, overflow: 'queue' });
      expect(enriched.tags).toEqual({ env: 'production' });
      expect(enriched.version).toBe('1.0.0');
    });

    it('returns undefined for optional opts not provided', () => {
      const pipeline = mockTerminalPipeline();
      const defined = definePipeline({ id: 'pk_pipe_minimal' }, pipeline);
      const enriched = defined.describe();
      expect(enriched.trigger).toBeUndefined();
      expect(enriched.retry).toBeUndefined();
      expect(enriched.concurrency).toBeUndefined();
      expect(enriched.tags).toBeUndefined();
      expect(enriched.version).toBeUndefined();
    });
  });

  describe('describe() — steps mapping', () => {
    it('maps pipeline steps to StepDescriptors with correct kinds', () => {
      const pipeline = mockTerminalPipeline();
      const defined = definePipeline({ id: 'pk_pipe_steps' }, pipeline);
      const enriched = defined.describe();

      expect(enriched.steps).toHaveLength(3);
      expect(enriched.steps[0]?.kind).toBe('source');
      expect(enriched.steps[1]?.kind).toBe('process');
      expect(enriched.steps[2]?.kind).toBe('serve');
    });

    it('maps step ids into StepDescriptor name field', () => {
      const pipeline = mockTerminalPipeline();
      const defined = definePipeline({ id: 'pk_pipe_ids' }, pipeline);
      const enriched = defined.describe();

      expect(enriched.steps[0]?.name).toBe('pk_src_test');
      expect(enriched.steps[1]?.name).toBe('pk_proc_test');
      expect(enriched.steps[2]?.name).toBe('pk_serve_test');
    });

    it('maps all step kinds: store and review', () => {
      const pipelineWithAll: TerminalPipeline<string> = {
        async run() {
          return ok({
            runId: 'pk_run_x',
            pipelineId: 'pk_pipe_x',
            output: 'x',
            atomCount: 1,
            duration: 50,
            metadata: {},
          });
        },
        describe() {
          return {
            pipelineId: 'pk_pipe_x',
            steps: [
              { kind: 'source' as const, source: { id: 'pk_src_a' } as unknown as Source<unknown> },
              { kind: 'store' as const, store: { id: 'pk_store_a' } as unknown as Store<unknown> },
              {
                kind: 'review' as const,
                reviewable: { id: 'pk_review_a' } as unknown as Reviewable<unknown>,
              },
              { kind: 'serve' as const, serve: { id: 'pk_serve_a' } as unknown as Serve<unknown> },
            ],
          };
        },
      };

      const defined = definePipeline({ id: 'pk_pipe_allkinds' }, pipelineWithAll);
      const enriched = defined.describe();

      expect(enriched.steps.map((s) => s.kind)).toEqual(['source', 'store', 'review', 'serve']);
      expect(enriched.steps[1]?.name).toBe('pk_store_a');
      expect(enriched.steps[2]?.name).toBe('pk_review_a');
    });
  });

  describe('run() — delegates to underlying pipeline', () => {
    it('delegates run() to the underlying TerminalPipeline', async () => {
      const pipeline = mockTerminalPipeline();
      const runSpy = vi.spyOn(pipeline, 'run');
      const defined = definePipeline({ id: 'pk_pipe_delegate' }, pipeline);

      await defined.run('some-input', { metadata: { key: 'val' }, idempotencyKey: 'idem-1' });

      expect(runSpy).toHaveBeenCalledOnce();
      expect(runSpy).toHaveBeenCalledWith('some-input', {
        metadata: { key: 'val' },
        signal: undefined,
        idempotencyKey: 'idem-1',
      });
    });

    it('returns the underlying pipeline run result on success', async () => {
      const pipeline = mockTerminalPipeline();
      const defined = definePipeline({ id: 'pk_pipe_success' }, pipeline);

      const result = await defined.run();
      expect(result.error).toBeNull();
      expect(result.data?.output).toBe('result');
      expect(result.data?.runId).toBe('pk_run_test');
      expect(result.data?.atomCount).toBe(1);
    });

    it('forwards signal through run options', async () => {
      const pipeline = mockTerminalPipeline();
      const runSpy = vi.spyOn(pipeline, 'run');
      const defined = definePipeline({ id: 'pk_pipe_signal' }, pipeline);
      const ac = new AbortController();

      await defined.run(undefined, { signal: ac.signal });

      expect(runSpy).toHaveBeenCalledWith(undefined, {
        metadata: undefined,
        signal: ac.signal,
        idempotencyKey: undefined,
      });
    });
  });
});

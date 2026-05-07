import { ROOT_CONTEXT } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { createContext } from '../src/context.js';

describe('PipelineContext', () => {
  describe('createContext', () => {
    it('fills sensible defaults from minimal opts', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_test' });

      expect(ctx.runId).toMatch(/^pk_run_/);
      expect(ctx.pipelineId).toBe('pk_pipe_test');
      expect(ctx.attempt).toBe(1);
      expect(ctx.metadata).toEqual({});
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
      expect(ctx.signal.aborted).toBe(false);
      expect(ctx.trace).toBe(ROOT_CONTEXT);
      expect(ctx.idempotencyKey).toBeUndefined();
      expect(ctx.memory).toBeUndefined();
    });

    it('passes provided opts through verbatim', () => {
      const ac = new AbortController();
      const ctx = createContext({
        pipelineId: 'pk_pipe_a',
        runId: 'pk_run_explicit',
        attempt: 3,
        metadata: { source: 'test' },
        signal: ac.signal,
        idempotencyKey: 'pk_evt_explicit',
      });

      expect(ctx.runId).toBe('pk_run_explicit');
      expect(ctx.attempt).toBe(3);
      expect(ctx.metadata).toEqual({ source: 'test' });
      expect(ctx.signal).toBe(ac.signal);
      expect(ctx.idempotencyKey).toBe('pk_evt_explicit');
    });
  });

  describe('AbortSignal pass-through', () => {
    it('propagates abort to the context signal', () => {
      const ac = new AbortController();
      const ctx = createContext({ pipelineId: 'pk_pipe_a', signal: ac.signal });

      expect(ctx.signal.aborted).toBe(false);
      ac.abort('cancel');
      expect(ctx.signal.aborted).toBe(true);
      expect(ctx.signal.reason).toBe('cancel');
    });

    it('default signal never aborts on its own', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      expect(ctx.signal.aborted).toBe(false);
    });
  });

  describe('metadata mutation', () => {
    it('attachMetadata adds keys observable through metadata', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      expect(ctx.metadata).toEqual({});

      ctx.attachMetadata('first', 1);
      expect(ctx.metadata).toEqual({ first: 1 });

      ctx.attachMetadata('second', 'two');
      expect(ctx.metadata).toEqual({ first: 1, second: 'two' });
    });

    it('attachMetadata preserves initial metadata', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a', metadata: { initial: true } });

      ctx.attachMetadata('extra', 'data');
      expect(ctx.metadata).toEqual({ initial: true, extra: 'data' });
    });

    it('initial metadata is copied (no shared reference)', () => {
      const initial: Record<string, unknown> = { mut: 'before' };
      const ctx = createContext({ pipelineId: 'pk_pipe_a', metadata: initial });

      initial.mut = 'after';
      expect(ctx.metadata).toEqual({ mut: 'before' });
    });

    it('attachMetadata overwrites existing keys', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a', metadata: { key: 'old' } });

      ctx.attachMetadata('key', 'new');
      expect(ctx.metadata).toEqual({ key: 'new' });
    });
  });
});

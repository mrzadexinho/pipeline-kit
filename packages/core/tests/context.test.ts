import { ROOT_CONTEXT } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { createContext, deriveAtomCtx } from '../src/context.js';

describe('PipelineContext', () => {
  describe('createContext', () => {
    it('fills sensible defaults from minimal opts', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_test' });

      expect(ctx.runId).toMatch(/^pk_run_/);
      expect(ctx.pipelineId).toBe('pk_pipe_test');
      expect(ctx.attempt).toBeUndefined();
      expect(ctx.metadata).toEqual({});
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
      expect(ctx.signal.aborted).toBe(false);
      expect(ctx.trace).toBe(ROOT_CONTEXT);
      expect(ctx.idempotencyKey).toBeUndefined();
      expect(ctx.memory).toBeUndefined();
      expect(ctx.deps).toEqual({});
      expect(ctx.usage.get('anything')).toBe(0);
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

    it('deps defaults to frozen empty object', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      expect(ctx.deps).toEqual({});
      expect(Object.isFrozen(ctx.deps)).toBe(true);
    });

    it('deps passed in opts are frozen and accessible', () => {
      const mem = { get: async () => null, set: async () => {}, delete: async () => {} };
      const ctx = createContext({ pipelineId: 'pk_pipe_a', deps: { memory: mem } });
      expect(ctx.deps.memory).toBe(mem);
      expect(Object.isFrozen(ctx.deps)).toBe(true);
    });

    it('usage defaults return 0 for unknown keys', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      expect(ctx.usage.get('tokens')).toBe(0);
      ctx.usage.record('tokens', 42);
      expect(ctx.usage.get('tokens')).toBe(42);
    });

    it('attempt undefined means non-durable', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      expect(ctx.attempt).toBeUndefined();
    });

    it('attempt passes through when provided', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a', attempt: 2 });
      expect(ctx.attempt).toBe(2);
    });
  });

  describe('deriveAtomCtx', () => {
    it('propagates deps from parent (same reference)', () => {
      const mem = { get: async () => null, set: async () => {}, delete: async () => {} };
      const parent = createContext({ pipelineId: 'pk_pipe_a', deps: { memory: mem } });
      const atom = deriveAtomCtx(parent, 'pk_atom_idem');
      expect(atom.deps).toBe(parent.deps);
    });

    it('propagates usage from parent (same reference)', () => {
      const parent = createContext({ pipelineId: 'pk_pipe_a' });
      parent.usage.record('tokens', 10);
      const atom = deriveAtomCtx(parent, 'pk_atom_idem');
      expect(atom.usage).toBe(parent.usage);
      expect(atom.usage.get('tokens')).toBe(10);
    });

    it('propagates attempt (including undefined) from parent', () => {
      const parent = createContext({ pipelineId: 'pk_pipe_a' });
      const atom = deriveAtomCtx(parent, 'pk_atom_idem');
      expect(atom.attempt).toBeUndefined();

      const parent2 = createContext({ pipelineId: 'pk_pipe_a', attempt: 5 });
      const atom2 = deriveAtomCtx(parent2, 'pk_atom_idem2');
      expect(atom2.attempt).toBe(5);
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

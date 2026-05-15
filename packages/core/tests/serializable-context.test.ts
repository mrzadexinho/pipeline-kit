import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext } from '../src/context.js';
import {
  extractWireContext,
  injectWireContext,
  type SerializableContext,
} from '../src/serializable-context.js';

describe('SerializableContext helpers', () => {
  describe('extractWireContext (no-op propagator)', () => {
    it('returns correct shape with string fields', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a', idempotencyKey: 'idem-1' });
      const wire = extractWireContext(ctx);

      expect(typeof wire.runId).toBe('string');
      expect(wire.runId).toMatch(/^pk_run_/);
      expect(typeof wire.trace.traceparent).toBe('string');
      expect(wire.idempotencyKey).toBe('idem-1');
    });

    it('falls back to empty string for traceparent when no propagator registered', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      const wire = extractWireContext(ctx);
      expect(wire.trace.traceparent).toBe('');
    });

    it('falls back to empty string for idempotencyKey when missing on context', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      const wire = extractWireContext(ctx);
      expect(wire.idempotencyKey).toBe('');
    });
  });

  describe('extractWireContext + injectWireContext with W3C propagator', () => {
    beforeAll(() => {
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    });

    afterAll(() => {
      propagation.disable();
    });

    it('round-trip: extract → inject → extract yields same values', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a', idempotencyKey: 'idem-rt' });
      const wire1 = extractWireContext(ctx);

      const ctx2 = injectWireContext(wire1, ctx);
      const wire2 = extractWireContext(ctx2);

      expect(wire2.runId).toBe(wire1.runId);
      expect(wire2.idempotencyKey).toBe(wire1.idempotencyKey);
      expect(wire2.trace.traceparent).toBe(wire1.trace.traceparent);
    });

    it('injectWireContext restores idempotencyKey from wireCtx', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      const wireCtx: SerializableContext = {
        runId: 'pk_run_injected',
        trace: { traceparent: '' },
        idempotencyKey: 'injected-key',
      };
      const ctx2 = injectWireContext(wireCtx, ctx);
      expect(ctx2.idempotencyKey).toBe('injected-key');
    });

    it('injectWireContext propagates tracestate when present', () => {
      const ctx = createContext({ pipelineId: 'pk_pipe_a' });
      const wireCtx: SerializableContext = {
        runId: ctx.runId,
        trace: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          tracestate: 'vendor=value',
        },
        idempotencyKey: '',
      };
      const wire = extractWireContext(injectWireContext(wireCtx, ctx));
      expect(wire.trace.traceparent).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { SerializableContext } from '../../src/serializable-context.js';
import { attachTraceToFrame, extractTraceFromFrame } from '../../src/wire/trace-wire.js';
import type { WireFrame } from '../../src/wire/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const W3C_TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b9c7c989f97918e1-01';
const W3C_TRACESTATE = 'rojo=00f067aa0ba902b7,congo=t61rcWkgMzE';

const ctx: SerializableContext = {
  runId: 'pk_run_test',
  trace: { traceparent: W3C_TRACEPARENT },
  idempotencyKey: 'idem-test',
};

const ctxWithTracestate: SerializableContext = {
  runId: 'pk_run_test',
  trace: { traceparent: W3C_TRACEPARENT, tracestate: W3C_TRACESTATE },
  idempotencyKey: 'idem-test',
};

const emptyCtx: SerializableContext = {
  runId: 'pk_run_test',
  trace: { traceparent: '' },
  idempotencyKey: 'idem-test',
};

// ---------------------------------------------------------------------------
// attachTraceToFrame
// ---------------------------------------------------------------------------

describe('attachTraceToFrame', () => {
  it('LSP form: sets envelope traceparent; body unchanged', () => {
    const frame: WireFrame<{ x: number }> = { body: { x: 1 } };
    const result = attachTraceToFrame(frame, ctx);

    expect(result.traceparent).toBe(W3C_TRACEPARENT);
    expect(result.tracestate).toBeUndefined();
    // Body must be the original value (unchanged — no metadata injection for plain objects without metadata)
    expect(result.body).toEqual({ x: 1 });
  });

  it('NDJSON form: injects into body.metadata.traceparent; input frame not mutated', () => {
    const originalMeta = { version: '1' };
    const frame: WireFrame<{ metadata: Record<string, unknown>; id: string }> = {
      body: { metadata: originalMeta, id: 'pk_atom_01' },
    };
    const result = attachTraceToFrame(frame, ctx);

    // Injected into body metadata
    expect((result.body as { metadata: Record<string, unknown> }).metadata.traceparent).toBe(
      W3C_TRACEPARENT,
    );
    // Input frame's body.metadata must not be mutated
    expect(originalMeta.traceparent).toBeUndefined();
    expect(frame.body.metadata.traceparent).toBeUndefined();
    // Envelope also set (LSP path)
    expect(result.traceparent).toBe(W3C_TRACEPARENT);
  });

  it('no-metadata fallback: primitive body — only envelope traceparent set; no body injection', () => {
    const frame: WireFrame<string> = { body: 'plain-string' };
    const result = attachTraceToFrame(frame, ctx);

    expect(result.traceparent).toBe(W3C_TRACEPARENT);
    expect(result.body).toBe('plain-string');
  });

  it('empty-traceparent: returns frame UNCHANGED (reference equality)', () => {
    const frame: WireFrame<{ x: number }> = { body: { x: 42 } };
    const result = attachTraceToFrame(frame, emptyCtx);

    expect(result).toBe(frame); // same reference — no new object
  });

  it('with tracestate: both traceparent and tracestate propagate to envelope and body.metadata', () => {
    const frame: WireFrame<{ metadata: Record<string, unknown> }> = {
      body: { metadata: {} },
    };
    const result = attachTraceToFrame(frame, ctxWithTracestate);

    // Envelope
    expect(result.traceparent).toBe(W3C_TRACEPARENT);
    expect(result.tracestate).toBe(W3C_TRACESTATE);
    // Body metadata
    const meta = (result.body as { metadata: Record<string, unknown> }).metadata;
    expect(meta.traceparent).toBe(W3C_TRACEPARENT);
    expect(meta.tracestate).toBe(W3C_TRACESTATE);
  });

  it('array body: treated as no-metadata (array is not a record); only envelope set', () => {
    const frame: WireFrame<number[]> = { body: [1, 2, 3] };
    const result = attachTraceToFrame(frame, ctx);

    expect(result.traceparent).toBe(W3C_TRACEPARENT);
    expect(result.body).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// extractTraceFromFrame
// ---------------------------------------------------------------------------

describe('extractTraceFromFrame', () => {
  it('LSP form: returns envelope traceparent', () => {
    const frame: WireFrame<unknown> = { body: {}, traceparent: W3C_TRACEPARENT };
    const result = extractTraceFromFrame(frame);

    expect(result).not.toBeNull();
    expect(result?.traceparent).toBe(W3C_TRACEPARENT);
    expect(result?.tracestate).toBeUndefined();
  });

  it('NDJSON form: returns body.metadata.traceparent when no envelope', () => {
    const frame: WireFrame<{ metadata: { traceparent: string } }> = {
      body: { metadata: { traceparent: W3C_TRACEPARENT } },
    };
    const result = extractTraceFromFrame(frame);

    expect(result).not.toBeNull();
    expect(result?.traceparent).toBe(W3C_TRACEPARENT);
  });

  it('priority: envelope traceparent wins over body.metadata.traceparent', () => {
    const envelopeParent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-aaaaaaaaaaaaaaaa-01';
    const metaParent = '00-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-bbbbbbbbbbbbbbbb-01';
    const frame: WireFrame<{ metadata: { traceparent: string } }> = {
      body: { metadata: { traceparent: metaParent } },
      traceparent: envelopeParent,
    };
    const result = extractTraceFromFrame(frame);

    expect(result?.traceparent).toBe(envelopeParent);
  });

  it('no trace: returns null when neither envelope nor body.metadata has traceparent', () => {
    const frame: WireFrame<{ x: number }> = { body: { x: 1 } };
    const result = extractTraceFromFrame(frame);

    expect(result).toBeNull();
  });

  it('non-string trace value in body.metadata: returns null (defensive type guard)', () => {
    const frame: WireFrame<{ metadata: { traceparent: number } }> = {
      body: { metadata: { traceparent: 12345 } },
    };
    // Cast to satisfy TS — tests the runtime guard
    const result = extractTraceFromFrame(frame as WireFrame<unknown>);

    expect(result).toBeNull();
  });

  it('tracestate propagates when present in envelope', () => {
    const frame: WireFrame<unknown> = {
      body: {},
      traceparent: W3C_TRACEPARENT,
      tracestate: W3C_TRACESTATE,
    };
    const result = extractTraceFromFrame(frame);

    expect(result?.traceparent).toBe(W3C_TRACEPARENT);
    expect(result?.tracestate).toBe(W3C_TRACESTATE);
  });

  it('tracestate propagates when present in body.metadata', () => {
    const frame: WireFrame<{ metadata: { traceparent: string; tracestate: string } }> = {
      body: { metadata: { traceparent: W3C_TRACEPARENT, tracestate: W3C_TRACESTATE } },
    };
    const result = extractTraceFromFrame(frame);

    expect(result?.traceparent).toBe(W3C_TRACEPARENT);
    expect(result?.tracestate).toBe(W3C_TRACESTATE);
  });
});

// ---------------------------------------------------------------------------
// Round-trip property (acceptance criterion #13)
// ---------------------------------------------------------------------------

describe('round-trip: extractTraceFromFrame(attachTraceToFrame(frame, ctx)) === ctx.trace.traceparent', () => {
  it('record-body with metadata: round-trip preserves traceparent', () => {
    const frame: WireFrame<{ metadata: Record<string, unknown>; value: number }> = {
      body: { metadata: {}, value: 42 },
    };
    const attached = attachTraceToFrame(frame, ctx);
    const extracted = extractTraceFromFrame(attached);

    expect(extracted?.traceparent).toBe(ctx.trace.traceparent);
  });

  it('primitive-body (no metadata): round-trip preserves traceparent via envelope', () => {
    const frame: WireFrame<number> = { body: 99 };
    const attached = attachTraceToFrame(frame, ctx);
    const extracted = extractTraceFromFrame(attached);

    expect(extracted?.traceparent).toBe(ctx.trace.traceparent);
  });

  it('with tracestate: round-trip preserves both traceparent and tracestate', () => {
    const frame: WireFrame<{ metadata: Record<string, unknown> }> = {
      body: { metadata: {} },
    };
    const attached = attachTraceToFrame(frame, ctxWithTracestate);
    const extracted = extractTraceFromFrame(attached);

    expect(extracted?.traceparent).toBe(ctxWithTracestate.trace.traceparent);
    expect(extracted?.tracestate).toBe(ctxWithTracestate.trace.tracestate);
  });
});

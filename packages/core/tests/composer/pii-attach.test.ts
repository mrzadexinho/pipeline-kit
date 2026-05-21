import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ComposerStep, runComposer } from '../../src/composer/composer.js';
import { precomputeStepPiiAnnotations } from '../../src/composer/pii-attach.js';
import { ok } from '../../src/result.js';

// ─── OTel in-memory setup (mirrors otel.property.test.ts pattern) ─────────────

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

// ─── Unit tests: precomputeStepPiiAnnotations ─────────────────────────────────

describe('precomputeStepPiiAnnotations', () => {
  it('returns undefined when outputSchema is undefined', () => {
    expect(precomputeStepPiiAnnotations(undefined)).toBeUndefined();
  });

  it('returns undefined when schema has no annotated fields (empty array collapses)', () => {
    const schema = z.object({ x: z.string() });
    expect(precomputeStepPiiAnnotations(schema)).toBeUndefined();
  });

  it('returns annotation array for @redact field', () => {
    const schema = z.object({ email: z.string().describe('@redact') });
    const result = precomputeStepPiiAnnotations(schema);
    expect(result).toEqual([{ path: ['email'], tag: 'redact' }]);
  });

  it('returns annotation array for @secret field', () => {
    const schema = z.object({ token: z.string().describe('@secret') });
    const result = precomputeStepPiiAnnotations(schema);
    expect(result).toEqual([{ path: ['token'], tag: 'secret' }]);
  });

  it('returns multiple annotations for mixed @redact and @secret fields', () => {
    const schema = z.object({
      email: z.string().describe('@redact'),
      token: z.string().describe('@secret'),
      name: z.string(),
    });
    const result = precomputeStepPiiAnnotations(schema);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ path: ['email'], tag: 'redact' });
    expect(result).toContainEqual({ path: ['token'], tag: 'secret' });
  });
});

// ─── Integration: span attribute wire-up ─────────────────────────────────────

describe('piiAnnotations → pk.pii_annotations span attribute', () => {
  beforeEach(() => exporter.reset());

  it('step with piiAnnotations emits pk.pii_annotations on its span', async () => {
    const annotations = [{ path: ['email'], tag: 'redact' as const }];
    const step: ComposerStep = {
      id: 'pk_proc_pii_test',
      kind: 'process',
      piiAnnotations: annotations,
      async run(input) {
        return ok(input);
      },
    };

    await runComposer({
      pipelineId: 'pk_pipe_pii_test',
      steps: [step],
      initialInput: { email: 'test@example.com' },
    });

    const spans = exporter.getFinishedSpans();
    const procSpan = spans.find((s) => s.attributes.stageId === 'pk_proc_pii_test');
    expect(procSpan).toBeDefined();
    const attrValue = procSpan?.attributes['pk.pii_annotations'];
    expect(typeof attrValue).toBe('string');
    expect(JSON.parse(attrValue as string)).toEqual(annotations);
  });

  it('step without piiAnnotations emits no pk.pii_annotations attribute', async () => {
    const step: ComposerStep = {
      id: 'pk_proc_no_pii',
      kind: 'process',
      async run(input) {
        return ok(input);
      },
    };

    await runComposer({
      pipelineId: 'pk_pipe_no_pii',
      steps: [step],
      initialInput: 'hello',
    });

    const spans = exporter.getFinishedSpans();
    const procSpan = spans.find((s) => s.attributes.stageId === 'pk_proc_no_pii');
    expect(procSpan).toBeDefined();
    expect(procSpan?.attributes['pk.pii_annotations']).toBeUndefined();
  });
});

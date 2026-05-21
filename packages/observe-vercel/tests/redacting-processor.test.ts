import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_SENSITIVE,
  PII_ANNOTATIONS_ATTR,
  RedactingProcessor,
  type RedactingProcessorOptions,
} from '../src/index.js';

/**
 * Smoke tests confirming that RedactingProcessor (and related exports) are
 * accessible from @idriszade/observe-vercel and behave correctly.
 *
 * NOTE: Use forceFlush() to flush spans before reading getFinishedSpans().
 * InMemorySpanExporter.shutdown() resets its span list, so read before shutdown.
 */

function makeSetup(options?: RedactingProcessorOptions) {
  const exporter = new InMemorySpanExporter();
  const inner = new SimpleSpanProcessor(exporter);
  const processor = new RedactingProcessor(inner, options);
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  return { provider, exporter };
}

describe('observe-vercel — RedactingProcessor re-export surface', () => {
  it('RedactingProcessor is importable from @idriszade/observe-vercel', () => {
    expect(RedactingProcessor).toBeDefined();
    expect(typeof RedactingProcessor).toBe('function');
  });

  it('KNOWN_SENSITIVE includes gen_ai.prompt and gen_ai.completion as secret', () => {
    expect(KNOWN_SENSITIVE['gen_ai.prompt']).toBe('secret');
    expect(KNOWN_SENSITIVE['gen_ai.completion']).toBe('secret');
  });

  it('PII_ANNOTATIONS_ATTR constant is the expected string', () => {
    expect(PII_ANNOTATIONS_ATTR).toBe('pk.pii_annotations');
  });

  it('gen_ai.prompt attribute is redacted to <secret:...> via re-exported processor', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('vercel-test');
    const span = tracer.startSpan('llm-call');
    span.setAttribute('gen_ai.prompt', 'what is the meaning of life');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs['gen_ai.prompt']).toMatch(/^<secret:[0-9a-f]{8}>$/);
  });

  it('pk.pii_annotations hint is consumed and stripped by re-exported processor', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('vercel-test');
    const span = tracer.startSpan('annotated-call');
    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([{ path: ['user', 'email'], tag: 'redact' }]),
    );
    span.setAttribute('user.email', 'bob@example.com');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs['user.email']).toMatch(/^<redacted:\d+>$/);
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
  });
});

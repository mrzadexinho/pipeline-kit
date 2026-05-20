/**
 * C4: Allowlist mode hard gate — ADR VIII-6.g
 *
 * RedactingProcessor in allowlist mode must:
 *   - Pass through ONLY attributes annotated with tag 'safe' in pk.pii_annotations.
 *   - Redact all other string attributes with <redacted:N>.
 *   - Still apply knownSensitive table (path 1) — those get hashed/redacted per tag.
 *   - Strip pk.pii_annotations (it's metadata, not user-visible).
 *   - Known-sensitive table entries take priority over safe-tag (safe does NOT override
 *     path 1 for keys already processed by the sensitive table).
 */
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { PII_ANNOTATIONS_ATTR, RedactingProcessor } from '../src/redacting-processor.js';

function makeAllowlistSetup(
  options?: Omit<ConstructorParameters<typeof RedactingProcessor>[1], 'mode'>,
) {
  const exporter = new InMemorySpanExporter();
  const inner = new SimpleSpanProcessor(exporter);
  const processor = new RedactingProcessor(inner, { ...options, mode: 'allowlist' });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  return { provider, exporter };
}

describe('RedactingProcessor — allowlist mode (ADR VIII-6.g)', () => {
  it('safe-tagged attribute passes through; untagged attributes are redacted', async () => {
    const { provider, exporter } = makeAllowlistSetup();
    const tracer = provider.getTracer('test-allowlist');
    const span = tracer.startSpan('safe-call');

    // Only 'user.id' is annotated safe — everything else must be redacted.
    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([{ path: ['user', 'id'], tag: 'safe' }]),
    );
    span.setAttribute('user.id', 'usr_123');
    span.setAttribute('user.email', 'alice@example.com');
    span.setAttribute('user.name', 'Alice');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes ?? {};

    // Safe-tagged: must pass through unchanged.
    expect(attrs['user.id']).toBe('usr_123');

    // Non-tagged strings: must be redacted.
    expect(attrs['user.email']).toMatch(/^<redacted:\d+>$/);
    expect(attrs['user.name']).toMatch(/^<redacted:\d+>$/);

    // hint attribute always stripped.
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
  });

  it('no annotations: ALL string attributes are redacted in allowlist mode', async () => {
    const { provider, exporter } = makeAllowlistSetup();
    const tracer = provider.getTracer('test-allowlist-no-ann');
    const span = tracer.startSpan('no-ann-call');

    span.setAttribute('model', 'gpt-4o');
    span.setAttribute('request_id', 'req_abc');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes ?? {};

    // No safe annotations → all redacted.
    expect(attrs.model).toMatch(/^<redacted:\d+>$/);
    expect(attrs.request_id).toMatch(/^<redacted:\d+>$/);
  });

  it('knownSensitive table overrides safe-tag: sensitive key is hashed even if safe-tagged', async () => {
    // gen_ai.prompt is in KNOWN_SENSITIVE as 'secret'.
    // Even if the user annotates it safe, path 1 runs first and wins.
    const { provider, exporter } = makeAllowlistSetup();
    const tracer = provider.getTracer('test-sensitive-wins');
    const span = tracer.startSpan('sensitive-override');

    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([{ path: ['gen_ai', 'prompt'], tag: 'safe' }]),
    );
    span.setAttribute('gen_ai.prompt', 'tell me a joke');
    span.setAttribute('gen_ai.system', 'openai');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes ?? {};

    // path 1 runs first: gen_ai.prompt is in KNOWN_SENSITIVE → hashed.
    // The safe annotation for this key is redundant but must not override path 1.
    expect(attrs['gen_ai.prompt']).toMatch(/^<secret:[0-9a-f]{8}>$/);

    // gen_ai.system is not safe-tagged → redacted by allowlist sweep.
    expect(attrs['gen_ai.system']).toMatch(/^<redacted:\d+>$/);
  });

  it('multiple safe keys: all pass through; remaining string attrs redacted', async () => {
    const { provider, exporter } = makeAllowlistSetup();
    const tracer = provider.getTracer('test-multi-safe');
    const span = tracer.startSpan('multi-safe-call');

    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([
        { path: ['trace_id'], tag: 'safe' },
        { path: ['operation'], tag: 'safe' },
      ]),
    );
    span.setAttribute('trace_id', 'tr_abc123');
    span.setAttribute('operation', 'create_user');
    span.setAttribute('user.email', 'bob@example.com');
    span.setAttribute('ssn', '123-45-6789');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes ?? {};

    expect(attrs.trace_id).toBe('tr_abc123');
    expect(attrs.operation).toBe('create_user');
    expect(attrs['user.email']).toMatch(/^<redacted:\d+>$/);
    expect(attrs.ssn).toMatch(/^<redacted:\d+>$/);
  });

  it('denylist mode (default) is unaffected: non-annotated attrs pass through', async () => {
    // Regression: the default denylist mode must not change.
    const exporter = new InMemorySpanExporter();
    const inner = new SimpleSpanProcessor(exporter);
    const processor = new RedactingProcessor(inner); // no mode = denylist
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });
    const tracer = provider.getTracer('test-denylist-regression');
    const span = tracer.startSpan('regression-call');

    span.setAttribute('user.id', 'usr_999');
    span.setAttribute('user.name', 'Carol');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes ?? {};

    // Neither key is in KNOWN_SENSITIVE → both pass through unchanged in denylist mode.
    expect(attrs['user.id']).toBe('usr_999');
    expect(attrs['user.name']).toBe('Carol');
  });
});

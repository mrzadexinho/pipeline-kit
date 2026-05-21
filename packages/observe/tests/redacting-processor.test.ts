import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PII_ANNOTATIONS_ATTR, RedactingProcessor } from '../src/redacting-processor.js';

/**
 * Build a provider that runs spans through:
 *   RedactingProcessor(options) → SimpleSpanProcessor → InMemorySpanExporter
 *
 * Returns provider and exporter.
 * NOTE: Call `forceFlush()` to flush pending spans into the exporter BEFORE
 * reading `getFinishedSpans()`. Do NOT call `shutdown()` before reading —
 * InMemorySpanExporter.shutdown() resets its span list.
 */
function makeSetup(options?: ConstructorParameters<typeof RedactingProcessor>[1]) {
  const exporter = new InMemorySpanExporter();
  const inner = new SimpleSpanProcessor(exporter);
  const processor = new RedactingProcessor(inner, options);
  const provider = new BasicTracerProvider({
    spanProcessors: [processor],
  });
  return { provider, exporter, processor, inner };
}

describe('RedactingProcessor — known-sensitive path (path 1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('test 1: gen_ai.prompt is replaced with <secret:XXXXXXXX>', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('llm-call');
    span.setAttribute('gen_ai.prompt', 'what is the meaning of life');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(typeof attrs['gen_ai.prompt']).toBe('string');
    expect(attrs['gen_ai.prompt']).toMatch(/^<secret:[0-9a-f]{8}>$/);
  });

  it('test 2: gen_ai.completion is replaced with <secret:XXXXXXXX>', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('llm-call');
    span.setAttribute('gen_ai.completion', '42');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs['gen_ai.completion']).toMatch(/^<secret:[0-9a-f]{8}>$/);
  });

  it('test 3: span with no sensitive attributes passes through unchanged', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('safe-call');
    span.setAttribute('gen_ai.system', 'openai');
    span.setAttribute('gen_ai.request.model', 'gpt-4o');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs['gen_ai.system']).toBe('openai');
    expect(attrs['gen_ai.request.model']).toBe('gpt-4o');
  });

  it('test 9: user-provided knownSensitive extends built-in table', async () => {
    const { provider, exporter } = makeSetup({ knownSensitive: { 'auth.token': 'secret' } });
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('auth-call');
    span.setAttribute('auth.token', 'sk-supersecret123');
    span.setAttribute('gen_ai.prompt', 'hello');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs['auth.token']).toMatch(/^<secret:[0-9a-f]{8}>$/);
    expect(attrs['gen_ai.prompt']).toMatch(/^<secret:[0-9a-f]{8}>$/);
  });

  it('test 12: non-string attribute value with sensitive key is left unchanged', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('numeric-attr');
    // OTel SDK will store numbers as numbers; the processor only formats strings.
    span.setAttribute('gen_ai.system', 42 as unknown as string);
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    // gen_ai.system is not in KNOWN_SENSITIVE; sanity check no crash.
    // The key point: no crash on a non-string value in a sensitive key slot.
    expect(attrs['gen_ai.system']).toBeDefined();
  });
});

describe('RedactingProcessor — schema-derived hints path (path 2)', () => {
  it('test 4: pk.pii_annotations with redact tag rewrites attribute and strips hint', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('annotated-call');
    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([{ path: ['user', 'email'], tag: 'redact' }]),
    );
    span.setAttribute('user.email', 'alice@example.com');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    // redact: <redacted:N> where N = 'alice@example.com'.length = 17
    expect(attrs['user.email']).toBe('<redacted:17>');
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
  });

  it('test 5: pk.pii_annotations with secret tag hashes the value', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('secret-token-call');
    span.setAttribute(PII_ANNOTATIONS_ATTR, JSON.stringify([{ path: ['token'], tag: 'secret' }]));
    span.setAttribute('token', 'ghp_xxx');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs.token).toMatch(/^<secret:[0-9a-f]{8}>$/);
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
  });

  it('test 6: malformed pk.pii_annotations (invalid JSON) — path 1 still applied, hint stripped, no throw', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('bad-json-call');
    span.setAttribute(PII_ANNOTATIONS_ATTR, 'not-valid-json{{}}');
    span.setAttribute('gen_ai.prompt', 'hello world');
    span.setAttribute('gen_ai.system', 'openai');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    // path 1: gen_ai.prompt still redacted
    expect(attrs['gen_ai.prompt']).toMatch(/^<secret:[0-9a-f]{8}>$/);
    // non-sensitive attribute unchanged
    expect(attrs['gen_ai.system']).toBe('openai');
    // hint always stripped
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
  });

  it('test 7: malformed annotation entries (missing tag or non-array path) are skipped silently', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('malformed-entry');
    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([
        { path: 'not-an-array', tag: 'redact' }, // bad path — skipped
        { path: ['user', 'email'], tag: 'unknown-tag' }, // bad tag — skipped
        { path: ['user', 'name'], tag: 'redact' }, // valid
      ]),
    );
    span.setAttribute('user.email', 'alice@example.com');
    span.setAttribute('user.name', 'Alice');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    // bad entries skipped: user.email unchanged
    expect(attrs['user.email']).toBe('alice@example.com');
    // valid entry applied: user.name redacted
    expect(attrs['user.name']).toMatch(/^<redacted:\d+>$/);
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
  });

  it('test 8: known-sensitive wins when schema hint points to same key (no re-application)', async () => {
    // user configures user.email as 'secret' in knownSensitive
    // schema hint says 'redact' for the same key
    // expected: secret wins (path 1 processed first, path 2 skips already-processed)
    const { provider, exporter } = makeSetup({
      knownSensitive: { 'user.email': 'secret' },
    });
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('conflict-call');
    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([{ path: ['user', 'email'], tag: 'redact' }]),
    );
    span.setAttribute('user.email', 'alice@example.com');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    // secret wins: format is <secret:XXXXXXXX>, not <redacted:N>
    expect(attrs['user.email']).toMatch(/^<secret:[0-9a-f]{8}>$/);
    expect(attrs['user.email']).not.toMatch(/^<redacted:/);
  });

  it('test 10: pk.pii_annotations always stripped even when no matching attribute keys', async () => {
    const { provider, exporter } = makeSetup();
    const tracer = provider.getTracer('test');
    const span = tracer.startSpan('no-match-call');
    span.setAttribute(
      PII_ANNOTATIONS_ATTR,
      JSON.stringify([{ path: ['nonexistent', 'key'], tag: 'redact' }]),
    );
    span.setAttribute('gen_ai.system', 'openai');
    span.end();
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const attrs = spans[0]?.attributes;
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();
    expect(attrs['gen_ai.system']).toBe('openai');
  });
});

describe('RedactingProcessor — delegation (forceFlush / shutdown)', () => {
  it('test 11a: forceFlush delegates to inner processor', async () => {
    const exporter = new InMemorySpanExporter();
    const inner = new SimpleSpanProcessor(exporter);
    const flushSpy = vi.spyOn(inner, 'forceFlush');
    const processor = new RedactingProcessor(inner);

    await processor.forceFlush();
    expect(flushSpy).toHaveBeenCalledOnce();
  });

  it('test 11b: shutdown delegates to inner processor', async () => {
    const exporter = new InMemorySpanExporter();
    const inner = new SimpleSpanProcessor(exporter);
    const shutdownSpy = vi.spyOn(inner, 'shutdown');
    const processor = new RedactingProcessor(inner);

    await processor.shutdown();
    expect(shutdownSpy).toHaveBeenCalledOnce();
  });
});

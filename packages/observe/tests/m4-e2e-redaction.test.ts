/**
 * M4 End-to-End Redaction Integration Test (D1 Hard Gate)
 *
 * Exercises the full M4 pipeline:
 *   secrets-env resolver → markSecret schema → walkAnnotations →
 *   pk.pii_annotations hint → RedactingProcessor → InMemorySpanExporter
 *
 * ADR VIII-6 validated in production-shape flow.
 */

import { formatSecret, markSecret, walkAnnotations } from '@idriszade/core';
import { createEnvSecretsResolver } from '@idriszade/secrets-env';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PII_ANNOTATIONS_ATTR, RedactingProcessor } from '../src/redacting-processor.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const RAW_SECRET = 'super-sensitive-prod-secret';

// ─── Schema setup ─────────────────────────────────────────────────────────────

const InputSchema = z.object({ db_password: markSecret(z.string()) });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedactingProvider(): {
  provider: BasicTracerProvider;
  exporter: InMemorySpanExporter;
} {
  const exporter = new InMemorySpanExporter();
  const inner = new SimpleSpanProcessor(exporter);
  const redacting = new RedactingProcessor(inner);
  const provider = new BasicTracerProvider({ spanProcessors: [redacting] });
  return { provider, exporter };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('M4 e2e — schema annotation helpers (walkAnnotations + markSecret)', () => {
  it('walkAnnotations returns { path: [db_password], tag: secret }', () => {
    const annotations = walkAnnotations(InputSchema);
    expect(annotations).toContainEqual({ path: ['db_password'], tag: 'secret' });
  });
});

describe('M4 e2e — secrets-env resolver', () => {
  it('resolves DB_PASSWORD from injected source', async () => {
    const envSource: Record<string, string> = { DB_PASSWORD: RAW_SECRET };
    const resolver = createEnvSecretsResolver(z.object({ DB_PASSWORD: z.string() }), {
      source: envSource,
      envVarMap: { db_password: 'DB_PASSWORD' },
    });

    const result = await resolver.resolve('db_password');
    expect(result.error).toBeNull();
    expect(result.data).toBe(RAW_SECRET);
  });
});

describe('M4 e2e — RedactingProcessor hard gate (schema-derived hint path)', () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    ({ provider, exporter } = makeRedactingProvider());
  });

  it('raw secret MUST NOT appear in emitted span; <secret:8hex> MUST appear instead', async () => {
    // Simulate Process: resolve secret, attach to span with pii hint
    const envSource: Record<string, string> = { DB_PASSWORD: RAW_SECRET };
    const resolver = createEnvSecretsResolver(z.object({ DB_PASSWORD: z.string() }), {
      source: envSource,
      envVarMap: { db_password: 'DB_PASSWORD' },
    });

    const result = await resolver.resolve('db_password');
    expect(result.error).toBeNull();
    const secretValue = result.data!;

    const annotations = walkAnnotations(InputSchema);

    const tracer = provider.getTracer('m4-e2e');
    const span = tracer.startSpan('m4-e2e-process');
    span.setAttribute('db_password', secretValue);
    span.setAttribute(PII_ANNOTATIONS_ATTR, JSON.stringify(annotations));
    span.end();
    await provider.forceFlush();

    const exported = exporter.getFinishedSpans();
    expect(exported).toHaveLength(1);
    const attrs = exported[0]!.attributes;

    // Hard gate: raw secret MUST NOT appear in span output
    expect(attrs['db_password']).not.toBe(RAW_SECRET);
    expect(JSON.stringify(attrs)).not.toContain(RAW_SECRET);

    // Hard gate: formatted secret hash MUST appear
    expect(attrs['db_password']).toMatch(/^<secret:[0-9a-f]{8}>$/);

    // Stability: hash must be deterministic
    expect(attrs['db_password']).toBe(formatSecret(RAW_SECRET));

    // Hint attribute MUST be stripped before export
    expect(attrs[PII_ANNOTATIONS_ATTR]).toBeUndefined();

    await provider.shutdown();
  });
});

describe('M4 e2e — gen_ai.prompt known-sensitive table path', () => {
  it('gen_ai.prompt is redacted via known-sensitive table (no schema hint needed)', async () => {
    const { provider, exporter } = makeRedactingProvider();
    const tracer = provider.getTracer('m4-e2e');

    const span2 = tracer.startSpan('m4-e2e-genai');
    span2.setAttribute('gen_ai.prompt', 'What is the airspeed velocity of an unladen swallow?');
    span2.end();
    await provider.forceFlush();

    const exported2 = exporter.getFinishedSpans();
    const lastSpan = exported2[exported2.length - 1]!;
    expect(lastSpan.attributes['gen_ai.prompt']).toMatch(/^<secret:[0-9a-f]{8}>$/);

    await provider.shutdown();
  });
});

describe('M4 e2e — negative test (naive provider LEAKS raw secret)', () => {
  it('WITHOUT RedactingProcessor the raw secret value appears in the emitted span', async () => {
    const naiveExporter = new InMemorySpanExporter();
    const naiveProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(naiveExporter)],
    });
    const naiveTracer = naiveProvider.getTracer('m4-e2e-naive');

    const leakedSpan = naiveTracer.startSpan('leak');
    leakedSpan.setAttribute('db_password', RAW_SECRET);
    leakedSpan.end();
    await naiveProvider.forceFlush();

    const leaked = naiveExporter.getFinishedSpans();
    // The raw secret leaks — this proves the RedactingProcessor is load-bearing
    expect(leaked[0]!.attributes['db_password']).toBe(RAW_SECRET);

    await naiveProvider.shutdown();
  });
});

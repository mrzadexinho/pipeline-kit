import type { PiiAnnotation, PiiTag } from '@idriszade/core';
import { formatRedacted, formatSecret } from '@idriszade/core';
import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { KNOWN_SENSITIVE } from './known-sensitive.js';

/**
 * Internal attribute key carrying JSON-stringified `PiiAnnotation[]` (output of
 * `walkAnnotations(schema)`). The processor consumes and strips this attribute
 * before delegating to the inner processor.
 *
 * Composer integration (auto-attaching from Process schemas) is M5 carry.
 * Consumers may attach manually today via span.setAttribute(PII_ANNOTATIONS_ATTR, ...).
 */
export const PII_ANNOTATIONS_ATTR = 'pk.pii_annotations' as const;

export interface RedactingProcessorOptions {
  /**
   * Additional key→tag entries to merge with the built-in KNOWN_SENSITIVE table.
   * User entries override built-ins on key collision.
   */
  knownSensitive?: Record<string, PiiTag>;
}

function applyTag(tag: PiiTag, value: string): string {
  return tag === 'secret' ? formatSecret(value) : formatRedacted(value);
}

function isValidAnnotation(entry: unknown): entry is PiiAnnotation {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    Array.isArray(e.path) &&
    (e.path as unknown[]).every((seg) => typeof seg === 'string') &&
    (e.tag === 'redact' || e.tag === 'secret')
  );
}

/**
 * SpanProcessor that redacts/hashes attribute values before delegating to
 * an inner processor (typically BatchSpanProcessor or SimpleSpanProcessor).
 *
 * Two enforcement paths applied on `onEnd`:
 *   1. Known-sensitive attribute key table (always applied).
 *   2. Schema-derived hints via `pk.pii_annotations` attribute (when present).
 *
 * The hint attribute is stripped from the span before delegating to inner.
 *
 * ADR: VIII-6.d (application point), VIII-6.f (GenAI conventions).
 */
export class RedactingProcessor implements SpanProcessor {
  readonly #inner: SpanProcessor;
  readonly #sensitiveTable: Readonly<Record<string, PiiTag>>;

  constructor(inner: SpanProcessor, options?: RedactingProcessorOptions) {
    this.#inner = inner;
    // User entries override built-ins on collision.
    this.#sensitiveTable = { ...KNOWN_SENSITIVE, ...options?.knownSensitive };
  }

  onStart(span: Span, parentContext: Context): void {
    if (typeof this.#inner.onStart === 'function') {
      this.#inner.onStart(span, parentContext);
    }
  }

  onEnd(span: ReadableSpan): void {
    // Use the mutable attributes object directly — in @opentelemetry/sdk-trace-base v2.x
    // `span.attributes` on an ended span is the live Attributes object; direct mutation
    // is safe and preferred over replacing the reference (some collectors hold the old ref).
    const attrs = span.attributes as Record<string, unknown>;
    const processed = new Set<string>();

    // ── Path (1): known-sensitive table (always applied) ──────────────────────
    for (const [key, tag] of Object.entries(this.#sensitiveTable)) {
      const value = attrs[key];
      if (typeof value === 'string') {
        attrs[key] = applyTag(tag, value);
        processed.add(key);
      }
    }

    // ── Path (2): schema-derived hints via pk.pii_annotations ────────────────
    const hintsRaw = attrs[PII_ANNOTATIONS_ATTR];
    // Always strip the hint attribute before delegating (metadata, not user-visible).
    delete attrs[PII_ANNOTATIONS_ATTR];

    if (typeof hintsRaw === 'string') {
      let annotations: unknown;
      try {
        annotations = JSON.parse(hintsRaw);
      } catch {
        // Malformed JSON — silently skip path (2); path (1) results are kept.
        this.#inner.onEnd(span);
        return;
      }

      if (Array.isArray(annotations)) {
        for (const entry of annotations) {
          if (!isValidAnnotation(entry)) continue;
          const candidateKey = entry.path.join('.');
          if (processed.has(candidateKey)) continue; // path (1) wins
          const value = attrs[candidateKey];
          if (typeof value === 'string') {
            attrs[candidateKey] = applyTag(entry.tag, value);
          }
        }
      }
    }

    this.#inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }
}

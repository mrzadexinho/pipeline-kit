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

  /**
   * Redaction mode (ADR VIII-6.g).
   *
   * - `'denylist'` (default): attributes listed in knownSensitive or annotated
   *   with `@redact`/`@secret` are redacted; all others pass through unchanged.
   * - `'allowlist'`: ONLY attributes annotated with `@safe` (tag `'safe'`) in
   *   `pk.pii_annotations` pass through unchanged. Every other string attribute
   *   is redacted with `<redacted:N>`. The known-sensitive table still applies
   *   (those entries are hashed/redacted per their tag).
   *
   * The `knownSensitive` table always takes priority over allowlist pass-through.
   */
  mode?: 'denylist' | 'allowlist';
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
    (e.tag === 'redact' || e.tag === 'secret' || e.tag === 'safe')
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
  readonly #mode: 'denylist' | 'allowlist';

  constructor(inner: SpanProcessor, options?: RedactingProcessorOptions) {
    this.#inner = inner;
    // User entries override built-ins on collision.
    this.#sensitiveTable = { ...KNOWN_SENSITIVE, ...options?.knownSensitive };
    this.#mode = options?.mode ?? 'denylist';
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

    // ── Path (1): known-sensitive table (always applied in all modes) ─────────
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

    // Collect safe-tagged keys for allowlist mode.
    const safeKeys = new Set<string>();

    if (typeof hintsRaw === 'string') {
      let annotations: unknown;
      try {
        annotations = JSON.parse(hintsRaw);
      } catch {
        // Malformed JSON — silently skip path (2); path (1) results are kept.
        // In allowlist mode, all unresolved string attrs will be redacted below.
        this.#applyAllowlistFallback(attrs, processed, safeKeys);
        this.#inner.onEnd(span);
        return;
      }

      if (Array.isArray(annotations)) {
        for (const entry of annotations) {
          if (!isValidAnnotation(entry)) continue;
          const candidateKey = entry.path.join('.');

          if (entry.tag === 'safe') {
            // In allowlist mode: mark this key as safe (pass-through).
            safeKeys.add(candidateKey);
            continue;
          }

          // Denylist semantics: apply redact/secret tags.
          if (processed.has(candidateKey)) continue; // path (1) wins
          const value = attrs[candidateKey];
          if (typeof value === 'string') {
            attrs[candidateKey] = applyTag(entry.tag, value);
            processed.add(candidateKey);
          }
        }
      }
    }

    // ── Path (3): allowlist mode sweep ────────────────────────────────────────
    // In allowlist mode, redact every string attribute that was NOT processed by
    // the sensitive table (path 1) and is NOT explicitly marked safe (path 2).
    this.#applyAllowlistFallback(attrs, processed, safeKeys);

    this.#inner.onEnd(span);
  }

  /**
   * In allowlist mode: sweep all remaining string attributes and redact those
   * that are neither in `processed` (path 1) nor in `safeKeys` (path 2 safe tags).
   * No-op in denylist mode.
   */
  #applyAllowlistFallback(
    attrs: Record<string, unknown>,
    processed: Set<string>,
    safeKeys: Set<string>,
  ): void {
    if (this.#mode !== 'allowlist') return;
    for (const key of Object.keys(attrs)) {
      if (processed.has(key) || safeKeys.has(key)) continue;
      const value = attrs[key];
      if (typeof value === 'string') {
        attrs[key] = formatRedacted(value);
      }
    }
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }
}

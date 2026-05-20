import type { PiiTag } from '@idriszade/core';
import { GEN_AI_COMPLETION, GEN_AI_PROMPT } from './otel-genai-keys.js';

/**
 * Built-in known-sensitive attribute key table.
 *
 * Maps OTel span attribute keys to their PII enforcement tag.
 * Entries here are ALWAYS applied on `RedactingProcessor.onEnd`, regardless
 * of whether a schema-derived `pk.pii_annotations` hint is present.
 *
 * ADR: VIII-6.f (GenAI conventions: prompt/completion are secret material).
 */
export const KNOWN_SENSITIVE: Readonly<Record<string, PiiTag>> = {
  [GEN_AI_PROMPT]: 'secret',
  [GEN_AI_COMPLETION]: 'secret',
};

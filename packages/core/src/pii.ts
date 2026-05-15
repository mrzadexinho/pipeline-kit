/**
 * PII annotation markers for Zod `.describe()` calls.
 * Direction-only in M1; redaction hooks ship in M2.
 *
 * @example
 * z.string().describe(REDACT_TAG)  // marks field for redaction in logs/traces
 * z.string().describe(SECRET_TAG)  // marks field as secret material
 */

export const REDACT_TAG = '@redact' as const;
export const SECRET_TAG = '@secret' as const;

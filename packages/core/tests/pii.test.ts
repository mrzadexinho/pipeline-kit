import { describe, expect, it } from 'vitest';
import { REDACT_TAG, SECRET_TAG } from '../src/pii.js';

describe('PII constants', () => {
  it('REDACT_TAG is @redact', () => {
    expect(REDACT_TAG).toBe('@redact');
  });

  it('SECRET_TAG is @secret', () => {
    expect(SECRET_TAG).toBe('@secret');
  });

  it('tags are string literals', () => {
    // Type-level: these should be string literal types, not just string
    const r: '@redact' = REDACT_TAG;
    const s: '@secret' = SECRET_TAG;
    expect(r).toBe('@redact');
    expect(s).toBe('@secret');
  });
});

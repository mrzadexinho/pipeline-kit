import { describe, expect, it } from 'vitest';
import { encodeTimestamp, validateTimestamp } from '../../src/wire/timestamp.js';

describe('validateTimestamp', () => {
  describe('valid timestamps', () => {
    it('accepts millisecond-precision Z-suffix timestamp', () => {
      const r = validateTimestamp('2026-05-08T12:34:56.123Z');
      expect(r.error).toBeNull();
      expect(r.data).toBe('2026-05-08T12:34:56.123Z');
    });

    it('accepts positive offset timezone', () => {
      const r = validateTimestamp('2026-05-08T12:34:56.000+05:30');
      expect(r.error).toBeNull();
    });

    it('accepts negative offset timezone', () => {
      const r = validateTimestamp('2026-01-01T00:00:00.000-07:00');
      expect(r.error).toBeNull();
    });

    it('accepts leap day on leap year', () => {
      const r = validateTimestamp('2024-02-29T12:00:00.000Z');
      expect(r.error).toBeNull();
    });

    it('accepts last day of months with 30 days', () => {
      const r = validateTimestamp('2026-04-30T23:59:59.999Z');
      expect(r.error).toBeNull();
    });

    it('accepts last day of months with 31 days', () => {
      const r = validateTimestamp('2026-01-31T00:00:00.000Z');
      expect(r.error).toBeNull();
    });
  });

  describe('sub-millisecond precision rejection', () => {
    it('rejects 4-digit fractional seconds', () => {
      const r = validateTimestamp('2026-05-08T12:34:56.1234Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_sub_ms_precision');
    });

    it('rejects 7-digit fractional seconds', () => {
      const r = validateTimestamp('2026-05-08T12:34:56.1234567Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_sub_ms_precision');
    });

    it('rejects 1-digit fractional seconds (too few)', () => {
      const r = validateTimestamp('2026-05-08T12:34:56.1Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects 2-digit fractional seconds (too few)', () => {
      const r = validateTimestamp('2026-05-08T12:34:56.12Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });
  });

  describe('calendar validation', () => {
    it('rejects hour 24', () => {
      const r = validateTimestamp('2026-05-08T24:00:00.000Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects month 13', () => {
      const r = validateTimestamp('2026-13-08T12:34:56.123Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects month 0', () => {
      const r = validateTimestamp('2026-00-08T12:34:56.123Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects day 0', () => {
      const r = validateTimestamp('2026-05-00T12:34:56.123Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects Feb 29 on non-leap year', () => {
      const r = validateTimestamp('2026-02-29T12:00:00.000Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects Feb 30 even on leap year', () => {
      const r = validateTimestamp('2024-02-30T12:00:00.000Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects April 31', () => {
      const r = validateTimestamp('2026-04-31T12:00:00.000Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects minute 60', () => {
      const r = validateTimestamp('2026-05-08T12:60:00.000Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects second 60', () => {
      const r = validateTimestamp('2026-05-08T12:34:60.000Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });
  });

  describe('format validation', () => {
    it('rejects missing fractional seconds', () => {
      const r = validateTimestamp('2026-05-08T12:34:56Z');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects totally invalid string', () => {
      const r = validateTimestamp('not-a-timestamp');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });

    it('rejects date-only string', () => {
      const r = validateTimestamp('2026-05-08');
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/timestamp_format_invalid');
    });
  });
});

describe('encodeTimestamp', () => {
  it('encodes Date to Z-suffixed millisecond-precision ISO string', () => {
    const date = new Date('2026-05-08T12:34:56.123Z');
    expect(encodeTimestamp(date)).toBe('2026-05-08T12:34:56.123Z');
  });

  it('always emits Z suffix', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = encodeTimestamp(date);
    expect(result.endsWith('Z')).toBe(true);
  });

  it('round-trips through validateTimestamp', () => {
    const date = new Date('2026-05-22T09:15:30.456Z');
    const encoded = encodeTimestamp(date);
    const validated = validateTimestamp(encoded);
    expect(validated.error).toBeNull();
    expect(validated.data).toBe(encoded);
  });
});

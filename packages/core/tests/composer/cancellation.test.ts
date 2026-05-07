import { describe, expect, it } from 'vitest';
import {
  CANCELLED_RUN_ERROR,
  cancelledResult,
  combineSignals,
  isCancelled,
} from '../../src/composer/cancellation.js';

describe('CANCELLED_RUN_ERROR', () => {
  it('has type=cancelled and stable code', () => {
    expect(CANCELLED_RUN_ERROR.type).toBe('cancelled');
    expect(CANCELLED_RUN_ERROR.code).toBe('pipeline_cancelled');
  });
});

describe('cancelledResult', () => {
  it('returns Result wrapping CANCELLED_RUN_ERROR', () => {
    const r = cancelledResult();
    expect(r.data).toBeNull();
    expect(r.error).toBe(CANCELLED_RUN_ERROR);
  });
});

describe('isCancelled', () => {
  it('returns false for undefined signal', () => {
    expect(isCancelled(undefined)).toBe(false);
  });

  it('returns false for non-aborted signal', () => {
    const ac = new AbortController();
    expect(isCancelled(ac.signal)).toBe(false);
  });

  it('returns true once signal is aborted', () => {
    const ac = new AbortController();
    ac.abort();
    expect(isCancelled(ac.signal)).toBe(true);
  });
});

describe('combineSignals', () => {
  it('returns a fresh non-aborted signal when no signals are provided', () => {
    const s = combineSignals([]);
    expect(s.aborted).toBe(false);
  });

  it('returns the only signal directly when one is provided', () => {
    const ac = new AbortController();
    const s = combineSignals([ac.signal]);
    expect(s).toBe(ac.signal);
  });

  it('aborts when any source signal aborts', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals([a.signal, b.signal]);
    expect(combined.aborted).toBe(false);
    a.abort();
    expect(combined.aborted).toBe(true);
  });

  it('ignores undefined entries and combines valid signals', () => {
    const a = new AbortController();
    const combined = combineSignals([undefined, a.signal, undefined]);
    expect(combined.aborted).toBe(false);
    a.abort();
    expect(combined.aborted).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { decodeResult } from '../../src/wire/decode-result.js';

describe('decodeResult', () => {
  describe('ok branch', () => {
    it('returns ok({kind:ok, value}) when data is non-null and error is null', () => {
      const r = decodeResult({ data: 'x', error: null });
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ kind: 'ok', value: 'x' });
    });

    it('works with object payloads', () => {
      const r = decodeResult({ data: { id: '123', count: 5 }, error: null });
      expect(r.error).toBeNull();
      if (r.data === null) throw new Error('expected ok branch');
      expect(r.data.kind).toBe('ok');
      if (r.data.kind !== 'ok') throw new Error('expected ok kind');
      expect(r.data.value).toEqual({ id: '123', count: 5 });
    });

    it('works with numeric payloads', () => {
      const r = decodeResult({ data: 42, error: null });
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ kind: 'ok', value: 42 });
    });

    it('works with null-like but non-null data (false)', () => {
      const r = decodeResult({ data: false, error: null });
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ kind: 'ok', value: false });
    });

    it('works with empty string data', () => {
      const r = decodeResult({ data: '', error: null });
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ kind: 'ok', value: '' });
    });
  });

  describe('err branch', () => {
    it('returns ok({kind:err, error}) when data is null and error is non-null', () => {
      const error = { type: 'e', code: 'c', message: 'm' };
      const r = decodeResult({ data: null, error });
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ kind: 'err', error });
    });

    it('works with full ErrorEnvelope shape', () => {
      const error = {
        type: 'validation',
        code: 'invalid_input',
        message: 'Bad value',
        param: 'field',
        doc_url: 'https://docs.example.com',
      };
      const r = decodeResult({ data: null, error });
      expect(r.error).toBeNull();
      if (r.data === null) throw new Error('expected ok branch');
      expect(r.data.kind).toBe('err');
      if (r.data.kind !== 'err') throw new Error('expected err kind');
      expect(r.data.error).toEqual(error);
    });
  });

  describe('ambiguity guards', () => {
    it('returns err(wire/result_ambiguous) when both data and error are null', () => {
      const r = decodeResult({ data: null, error: null });
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/result_ambiguous');
    });

    it('returns err(wire/result_ambiguous) when both data and error are non-null', () => {
      const r = decodeResult({
        data: 'x',
        error: { type: 'e', code: 'c', message: 'm' },
      });
      expect(r.data).toBeNull();
      expect(r.error?.code).toBe('wire/result_ambiguous');
    });

    it('includes a descriptive message for both-null case', () => {
      const r = decodeResult({ data: null, error: null });
      expect(r.error?.message).toContain('null');
    });

    it('includes a descriptive message for both-non-null case', () => {
      const r = decodeResult({
        data: 'y',
        error: { type: 'e', code: 'c', message: 'm' },
      });
      expect(r.error?.message).toContain('ambiguous');
    });
  });

  describe('generic type inference', () => {
    it('infers T from data shape', () => {
      type Payload = { name: string; age: number };
      const r = decodeResult<Payload>({ data: { name: 'idris', age: 30 }, error: null });
      if (r.data === null) throw new Error('expected ok');
      if (r.data.kind !== 'ok') throw new Error('expected ok kind');
      // TypeScript type-level check: r.data.value.name should be string
      expect(r.data.value.name).toBe('idris');
    });
  });
});

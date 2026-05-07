import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../src/result.js';

describe('Result<T, E>', () => {
  describe('ok', () => {
    it('returns { data, error: null } shape', () => {
      const r = ok(42);
      expect(r.data).toBe(42);
      expect(r.error).toBeNull();
    });

    it('preserves payload type via narrowing', () => {
      const r: Result<{ user: string }> = ok({ user: 'idris' });
      if (r.error === null) {
        expect(r.data.user).toBe('idris');
      } else {
        expect.fail('expected ok branch');
      }
    });

    it('narrows to never on error access in success branch', () => {
      const r = ok('hi');
      if (r.error !== null) {
        expect.fail('error must be null on ok');
      }
      expect(r.data).toBe('hi');
    });
  });

  describe('err', () => {
    it('returns { data: null, error } shape', () => {
      const r = err({ type: 'validation', code: 'bad_input', message: 'bad' });
      expect(r.data).toBeNull();
      expect(r.error.type).toBe('validation');
      expect(r.error.code).toBe('bad_input');
    });

    it('accepts custom error shapes', () => {
      const r = err<{ kind: 'transport' }>({ kind: 'transport' });
      if (r.error === null) {
        expect.fail('expected error branch');
      }
      expect(r.error.kind).toBe('transport');
    });
  });
});

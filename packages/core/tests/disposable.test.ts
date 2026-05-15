import { describe, expect, it, vi } from 'vitest';
import {
  type DisposalOptions,
  createDisposableRegistry,
  isDisposable,
} from '../src/disposable.js';

describe('isDisposable', () => {
  it('returns true for object with close() method', () => {
    expect(isDisposable({ close: async () => {} })).toBe(true);
  });

  it('returns false for object without close', () => {
    expect(isDisposable({})).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isDisposable(null)).toBe(false);
    expect(isDisposable(undefined)).toBe(false);
    expect(isDisposable(42)).toBe(false);
    expect(isDisposable('str')).toBe(false);
  });

  it('returns false when close is not a function', () => {
    expect(isDisposable({ close: 'not-a-function' })).toBe(false);
  });
});

describe('createDisposableRegistry', () => {
  describe('LIFO disposal order', () => {
    it('disposes C, B, A when registered A, B, C', async () => {
      const order: string[] = [];
      const reg = createDisposableRegistry();

      reg.register('A', async () => { order.push('A'); });
      reg.register('B', async () => { order.push('B'); });
      reg.register('C', async () => { order.push('C'); });

      await reg.disposeAll();
      expect(order).toEqual(['C', 'B', 'A']);
    });
  });

  describe('timeout behaviour', () => {
    it('fires onTimeout when teardown exceeds timeoutMs', async () => {
      vi.useFakeTimers();
      const timedOut: string[] = [];

      const reg = createDisposableRegistry();
      reg.register('slow', async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      });

      const opts: DisposalOptions = {
        timeoutMs: 100,
        onTimeout: (name) => timedOut.push(name),
      };
      const disposePromise = reg.disposeAll(opts);
      await vi.advanceTimersByTimeAsync(200);
      await disposePromise;

      expect(timedOut).toContain('slow');
      vi.useRealTimers();
    });

    it('default timeoutMs is 5000', async () => {
      vi.useFakeTimers();
      const timedOut: string[] = [];
      const reg = createDisposableRegistry();

      reg.register('slow', async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      });

      const disposePromise = reg.disposeAll({ onTimeout: (name) => timedOut.push(name) });
      await vi.advanceTimersByTimeAsync(4999);
      expect(timedOut).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(2);
      await disposePromise;
      expect(timedOut).toContain('slow');
      vi.useRealTimers();
    });
  });

  describe('error behaviour', () => {
    it('fires onError when teardown throws', async () => {
      const errors: Array<{ name: string; err: Error }> = [];
      const reg = createDisposableRegistry();

      reg.register('failing', async () => {
        throw new Error('boom');
      });

      await reg.disposeAll({ onError: (name, err) => errors.push({ name, err }) });
      expect(errors).toHaveLength(1);
      expect(errors[0]!.name).toBe('failing');
      expect(errors[0]!.err.message).toBe('boom');
    });

    it('one adapter failure does not block others', async () => {
      const order: string[] = [];
      const errors: string[] = [];
      const reg = createDisposableRegistry();

      reg.register('A', async () => { order.push('A'); });
      reg.register('B', async () => { throw new Error('B failed'); });
      reg.register('C', async () => { order.push('C'); });

      await reg.disposeAll({ onError: (name) => errors.push(name) });

      // LIFO: C runs, B fails, A runs
      expect(order).toEqual(['C', 'A']);
      expect(errors).toEqual(['B']);
    });
  });
});

import type { TokenBucketConfig } from '../policy.js';

export const DEFAULT_TOKEN_BUCKET: TokenBucketConfig = {
  capacity: 10,
  refillRate: 10,
  intervalMs: 1000,
};

export interface TokenBucket {
  tryAcquire(count?: number): boolean;
  acquire(count?: number, signal?: AbortSignal): Promise<boolean>;
  available(): number;
}

export function createTokenBucket(config: TokenBucketConfig): TokenBucket {
  let tokens = config.capacity;
  let lastRefill = Date.now();

  const refill = (now: number): void => {
    const elapsed = now - lastRefill;
    if (elapsed <= 0) return;
    const tokensToAdd = (elapsed / config.intervalMs) * config.refillRate;
    tokens = Math.min(config.capacity, tokens + tokensToAdd);
    lastRefill = now;
  };

  const tryAcquire = (count = 1): boolean => {
    refill(Date.now());
    if (tokens >= count) {
      tokens -= count;
      return true;
    }
    return false;
  };

  const acquire = async (count = 1, signal?: AbortSignal): Promise<boolean> => {
    while (!tryAcquire(count)) {
      if (signal?.aborted) return false;
      const tokensNeeded = count - tokens;
      const waitMs = Math.max(
        10,
        Math.ceil((tokensNeeded / config.refillRate) * config.intervalMs),
      );
      const aborted = await sleep(waitMs, signal);
      if (aborted) return false;
    }
    return true;
  };

  const available = (): number => {
    refill(Date.now());
    return tokens;
  };

  return { tryAcquire, acquire, available };
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

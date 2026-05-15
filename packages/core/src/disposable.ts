export interface Disposable {
  close(): Promise<void>;
}

export function isDisposable(dep: unknown): dep is Disposable {
  return (
    typeof dep === 'object' &&
    dep !== null &&
    'close' in dep &&
    typeof (dep as Record<string, unknown>).close === 'function'
  );
}

export interface DisposalOptions {
  timeoutMs?: number;
  onTimeout?: (name: string, err: Error) => void;
  onError?: (name: string, err: Error) => void;
}

export interface DisposableRegistry {
  register(name: string, teardown: () => Promise<void>): void;
  disposeAll(options?: DisposalOptions): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDisposableRegistry(): DisposableRegistry {
  const entries: Array<{ name: string; teardown: () => Promise<void> }> = [];

  return {
    register(name, teardown) {
      entries.push({ name, teardown });
    },

    async disposeAll(options?: DisposalOptions) {
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const onTimeout = options?.onTimeout;
      const onError = options?.onError;

      // LIFO: iterate in reverse
      for (let i = entries.length - 1; i >= 0; i--) {
        const { name, teardown } = entries[i]!;
        const timeoutErr = new Error(`Disposal of "${name}" timed out after ${timeoutMs}ms`);

        let timedOut = false;
        const timeoutPromise = sleep(timeoutMs).then(() => {
          timedOut = true;
        });

        try {
          await Promise.race([teardown(), timeoutPromise]);
          if (timedOut) {
            onTimeout?.(name, timeoutErr);
          }
        } catch (err) {
          if (timedOut) {
            onTimeout?.(name, timeoutErr);
          } else {
            const errObj = err instanceof Error ? err : new Error(String(err));
            onError?.(name, errObj);
          }
        }
      }
    },
  };
}

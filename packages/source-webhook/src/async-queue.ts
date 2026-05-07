/**
 * Minimal async queue used as an internal buffer for incoming webhook atoms.
 * Items pushed before iteration starts are held and yielded in order.
 * If iteration is already running, the next item wakes the pending resolver.
 */
export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver !== undefined) {
      resolver({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    for (const resolver of this.resolvers) {
      resolver({ value: undefined as unknown as T, done: true });
    }
    this.resolvers = [];
  }

  /**
   * Returns a snapshot of the current buffer and clears it.
   * Used by fetch() for a non-blocking drain.
   */
  drain(): T[] {
    const snapshot = this.items.slice();
    this.items = [];
    return snapshot;
  }

  async *[Symbol.asyncIterator](signal?: AbortSignal): AsyncIterableIterator<T> {
    while (true) {
      if (signal?.aborted) return;

      if (this.items.length > 0) {
        yield this.items.shift() as T;
        continue;
      }

      if (this.closed) return;

      const next = await new Promise<IteratorResult<T>>((resolve) => {
        if (signal?.aborted) {
          resolve({ value: undefined as unknown as T, done: true });
          return;
        }

        const abortHandler = (): void => {
          const idx = this.resolvers.indexOf(resolve);
          if (idx !== -1) this.resolvers.splice(idx, 1);
          resolve({ value: undefined as unknown as T, done: true });
        };

        signal?.addEventListener('abort', abortHandler, { once: true });
        this.resolvers.push((result) => {
          signal?.removeEventListener('abort', abortHandler);
          resolve(result);
        });
      });

      if (next.done) return;
      yield next.value;
    }
  }
}

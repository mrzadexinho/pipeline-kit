export interface UsageAccumulator {
  record(key: string, delta: number): void;
  get(key: string): number;
  getAll(): ReadonlyMap<string, number>;
  merge(other: ReadonlyMap<string, number>): void;
}

export function createUsageAccumulator(): UsageAccumulator {
  const counts = new Map<string, number>();
  return {
    record(key: string, delta: number): void {
      counts.set(key, (counts.get(key) ?? 0) + delta);
    },
    get(key: string): number {
      return counts.get(key) ?? 0;
    },
    getAll(): ReadonlyMap<string, number> {
      return new Map(counts);
    },
    merge(other: ReadonlyMap<string, number>): void {
      for (const [key, value] of other) {
        this.record(key, value);
      }
    },
  };
}

export interface CostBudget {
  metric: string;
  limit: number;
  action: 'abort' | 'review' | 'warn';
}

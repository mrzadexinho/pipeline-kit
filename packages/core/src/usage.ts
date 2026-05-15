export interface UsageAccumulator {
  record(key: string, delta: number): void;
  get(key: string): number;
  getAll(): ReadonlyMap<string, number>;
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
  };
}

export interface CostBudget {
  metric: string;
  limit: number;
  action: 'abort' | 'review' | 'warn';
}

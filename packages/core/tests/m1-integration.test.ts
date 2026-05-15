import { describe, expect, it } from 'vitest';
import {
  createDisposableRegistry,
  createUsageAccumulator,
  definePipeline,
  isRetryable,
  ok,
  REDACT_TAG,
  RETRYABILITY_MAP,
  SECRET_TAG,
  type CostBudget,
  type Gate,
  type Process,
  type StageErrorCode,
  type TriggerConfig,
} from '../src/index.js';

describe('M1 cross-module integration', () => {
  it('all new types are importable from barrel export', () => {
    expect(createDisposableRegistry).toBeTypeOf('function');
    expect(createUsageAccumulator).toBeTypeOf('function');
    expect(definePipeline).toBeTypeOf('function');
    expect(isRetryable).toBeTypeOf('function');
    expect(RETRYABILITY_MAP).toBeInstanceOf(Map);
    expect(REDACT_TAG).toBe('@redact');
    expect(SECRET_TAG).toBe('@secret');
  });

  it('UsageAccumulator + CostBudget compose correctly', () => {
    const usage = createUsageAccumulator();
    usage.record('gen_ai.usage.input_tokens', 500);
    usage.record('gen_ai.usage.input_tokens', 300);

    const budget: CostBudget = {
      metric: 'gen_ai.usage.input_tokens',
      limit: 1000,
      action: 'abort',
    };

    expect(usage.get(budget.metric) >= budget.limit).toBe(false);
    usage.record('gen_ai.usage.input_tokens', 200);
    expect(usage.get(budget.metric) >= budget.limit).toBe(true);
  });

  it('DisposableRegistry integrates with the disposal lifecycle', async () => {
    const disposed: string[] = [];
    const registry = createDisposableRegistry();
    registry.register('adapter-a', async () => disposed.push('a'));
    registry.register('adapter-b', async () => disposed.push('b'));

    await registry.disposeAll();
    expect(disposed).toEqual(['b', 'a']);
  });

  it('StageErrorCode retryability is complete', () => {
    const codes: StageErrorCode[] = [
      'source_unavailable',
      'source_timeout',
      'runtime_budget_exceeded',
    ];
    expect(isRetryable(codes[0]!)).toBe(true);
    expect(isRetryable(codes[1]!)).toBe(true);
    expect(isRetryable(codes[2]!)).toBe(false);
  });

  it('TriggerConfig discriminated union works', () => {
    const triggers: TriggerConfig[] = [
      { kind: 'cron', expr: '0 * * * *' },
      { kind: 'webhook', path: '/hook' },
      { kind: 'event', name: 'order.created' },
      { kind: 'manual' },
      { kind: 'mcp', toolName: 'extract' },
    ];
    expect(triggers).toHaveLength(5);
    expect(triggers[0]!.kind).toBe('cron');
  });

  it('Gate<I> pattern is assignable as Process<I, I>', () => {
    const gate: Gate<string> = {
      id: 'pk_proc_gate',
      async run(input: string) {
        return ok(input);
      },
    };
    const process: Process<string, string> = gate;
    expect(process.id).toBe('pk_proc_gate');
  });
});


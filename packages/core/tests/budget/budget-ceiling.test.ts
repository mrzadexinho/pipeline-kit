import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type BudgetAccumulation,
  type BudgetCeiling,
  evaluateBudgetCeiling,
} from '../../src/budget.js';
import { recomputeAccumulation } from '../../src/composer/budget-accumulate.js';
import type { ComposerStep } from '../../src/composer/composer.js';
import { runComposer } from '../../src/composer/composer.js';
import { proc as procId } from '../../src/ids.js';
import { ok } from '../../src/result.js';
import type { StageErrorCode } from '../../src/stage-error.js';
import { RETRYABILITY_MAP } from '../../src/stage-error.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroAcc(overrides: Partial<BudgetAccumulation> = {}): BudgetAccumulation {
  return {
    totalDollars: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalRequests: 0,
    ...overrides,
  };
}

function makeStep(id: string, costEvent?: ComposerStep['costEvent']): ComposerStep {
  return {
    id,
    kind: 'process',
    costEvent,
    async run(_input) {
      return ok('out');
    },
  };
}

// ---------------------------------------------------------------------------
// Verify runtime_budget_exceeded in StageErrorCode + RETRYABILITY_MAP
// ---------------------------------------------------------------------------

describe('StageErrorCode verification (read-only)', () => {
  it('runtime_budget_exceeded exists in RETRYABILITY_MAP as never', () => {
    const code: StageErrorCode = 'runtime_budget_exceeded';
    expect(RETRYABILITY_MAP.get(code)).toBe('never');
  });
});

// ---------------------------------------------------------------------------
// evaluateBudgetCeiling — unit tests
// ---------------------------------------------------------------------------

describe('evaluateBudgetCeiling', () => {
  it('returns ok when no ceilings are configured', () => {
    const acc = zeroAcc({ totalDollars: 99 });
    expect(evaluateBudgetCeiling(acc, {})).toEqual({ status: 'ok' });
  });

  it('returns ok when all axes are below their ceilings', () => {
    const acc = zeroAcc({ totalDollars: 0.05, totalInputTokens: 100 });
    const ceiling: BudgetCeiling = { maxDollars: 0.1, maxInputTokens: 200 };
    expect(evaluateBudgetCeiling(acc, ceiling)).toEqual({ status: 'ok' });
  });

  it('returns warn when totalDollars / maxDollars >= warnAtFraction (explicit 0.8)', () => {
    // Use 0.085 / 0.10 = 0.85 to avoid 0.08/0.10 float precision edge (0.799...)
    const acc = zeroAcc({ totalDollars: 0.085 });
    const result = evaluateBudgetCeiling(acc, { maxDollars: 0.1, warnAtFraction: 0.8 });
    expect(result.status).toBe('warn');
    if (result.status === 'warn') {
      expect(result.axis).toBe('maxDollars');
      expect(result.fraction).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('returns warn at the highest-fraction axis when multiple axes cross the threshold', () => {
    // maxRequests: 85/100 = 0.85; maxInputTokens: 190/200 = 0.95 (higher fraction)
    const acc = zeroAcc({ totalRequests: 85, totalInputTokens: 190 });
    const ceiling: BudgetCeiling = { maxRequests: 100, maxInputTokens: 200, warnAtFraction: 0.8 };
    const result = evaluateBudgetCeiling(acc, ceiling);
    expect(result.status).toBe('warn');
    if (result.status === 'warn') {
      expect(result.axis).toBe('maxInputTokens'); // highest fraction = 0.95
    }
  });

  it('returns exceeded when totalDollars >= maxDollars', () => {
    const acc = zeroAcc({ totalDollars: 0.11 });
    const result = evaluateBudgetCeiling(acc, { maxDollars: 0.1 });
    expect(result.status).toBe('exceeded');
    if (result.status === 'exceeded') {
      expect(result.axis).toBe('maxDollars');
      expect(result.current).toBeCloseTo(0.11);
      expect(result.limit).toBeCloseTo(0.1);
    }
  });

  it('returns exceeded on exact equality (current === limit)', () => {
    const acc = zeroAcc({ totalInputTokens: 1000 });
    const result = evaluateBudgetCeiling(acc, { maxInputTokens: 1000 });
    expect(result.status).toBe('exceeded');
    if (result.status === 'exceeded') {
      expect(result.axis).toBe('maxInputTokens');
    }
  });

  it('prioritises exceeded over warn — even if warn fraction is higher on a different axis', () => {
    // maxDollars: 0.11 / 0.10 => exceeded; maxInputTokens: 190/200 = 0.95 => warn
    const acc = zeroAcc({ totalDollars: 0.11, totalInputTokens: 190 });
    const ceiling: BudgetCeiling = { maxDollars: 0.1, maxInputTokens: 200 };
    const result = evaluateBudgetCeiling(acc, ceiling);
    expect(result.status).toBe('exceeded');
    if (result.status === 'exceeded') {
      expect(result.axis).toBe('maxDollars');
    }
  });

  it('checks axes in declaration order: maxDollars first', () => {
    // Both maxDollars and maxInputTokens exceeded — should return maxDollars
    const acc = zeroAcc({ totalDollars: 0.15, totalInputTokens: 2000 });
    const ceiling: BudgetCeiling = { maxDollars: 0.1, maxInputTokens: 1000 };
    const result = evaluateBudgetCeiling(acc, ceiling);
    expect(result.status).toBe('exceeded');
    if (result.status === 'exceeded') {
      expect(result.axis).toBe('maxDollars');
    }
  });

  it('maxOutputTokens axis triggers exceeded correctly', () => {
    const acc = zeroAcc({ totalOutputTokens: 500 });
    const result = evaluateBudgetCeiling(acc, { maxOutputTokens: 499 });
    expect(result.status).toBe('exceeded');
    if (result.status === 'exceeded') {
      expect(result.axis).toBe('maxOutputTokens');
    }
  });

  it('maxRequests axis triggers exceeded correctly', () => {
    const acc = zeroAcc({ totalRequests: 10 });
    const result = evaluateBudgetCeiling(acc, { maxRequests: 10 });
    expect(result.status).toBe('exceeded');
    if (result.status === 'exceeded') {
      expect(result.axis).toBe('maxRequests');
    }
  });

  it('defaults warnAtFraction to 0.80 when not specified', () => {
    // Use integers to avoid float imprecision: 79 out of 100 = 79% — should NOT warn
    const acc = zeroAcc({ totalRequests: 79 });
    expect(evaluateBudgetCeiling(acc, { maxRequests: 100 })).toEqual({ status: 'ok' });
    // 85 out of 100 = 85% — should warn (well above 0.80 default)
    const acc2 = zeroAcc({ totalRequests: 85 });
    expect(evaluateBudgetCeiling(acc2, { maxRequests: 100 }).status).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// recomputeAccumulation — unit tests
// ---------------------------------------------------------------------------

describe('recomputeAccumulation', () => {
  it('returns zero accumulation for empty steps array', () => {
    expect(recomputeAccumulation([])).toEqual({
      totalDollars: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
    });
  });

  it('accumulates totalDollars from steps with costEvent', () => {
    const steps = [
      makeStep(procId(), {
        totalCost: 0.02,
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
      makeStep(procId(), {
        totalCost: 0.03,
        inputTokens: 150,
        outputTokens: 75,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ];
    const acc = recomputeAccumulation(steps);
    expect(acc.totalDollars).toBeCloseTo(0.05);
    expect(acc.totalInputTokens).toBe(250);
    expect(acc.totalOutputTokens).toBe(125);
    expect(acc.totalRequests).toBe(2);
  });

  it('steps without costEvent contribute 0 to dollar/token totals', () => {
    const steps = [
      makeStep(procId()), // no costEvent
      makeStep(procId(), {
        totalCost: 0.01,
        inputTokens: 50,
        outputTokens: 25,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ];
    const acc = recomputeAccumulation(steps);
    expect(acc.totalDollars).toBeCloseTo(0.01);
    expect(acc.totalInputTokens).toBe(50);
    expect(acc.totalRequests).toBe(2); // both steps count toward requests
  });

  it('is a pure function — calling twice on same input gives identical results', () => {
    const steps = [
      makeStep(procId(), {
        totalCost: 0.05,
        inputTokens: 200,
        outputTokens: 100,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ];
    const acc1 = recomputeAccumulation(steps);
    const acc2 = recomputeAccumulation(steps);
    expect(acc1).toEqual(acc2);
  });
});

// ---------------------------------------------------------------------------
// Composer integration — ceiling halts with runtime_budget_exceeded
// ---------------------------------------------------------------------------

describe('Composer — budgetCeiling integration', () => {
  it('returns Result.err with runtime_budget_exceeded when ceiling is breached (sequential)', async () => {
    // Step has costEvent.totalCost = 0.02 > maxDollars 0.01
    const step = makeStep(procId(), {
      totalCost: 0.02,
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const result = await runComposer({
      pipelineId: 'pk_pipe_ceiling_test',
      steps: [step],
      initialInput: 'in',
      budgetCeiling: { maxDollars: 0.01 },
    });

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('runtime_budget_exceeded');
    expect(result.error?.type).toBe('unknown');
  });

  it('does NOT halt when steps are below ceiling', async () => {
    const step = makeStep(procId(), {
      totalCost: 0.005,
      inputTokens: 50,
      outputTokens: 25,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const result = await runComposer({
      pipelineId: 'pk_pipe_ceiling_ok',
      steps: [step],
      initialInput: 'in',
      budgetCeiling: { maxDollars: 0.1 },
    });

    expect(result.error).toBeNull();
  });

  it('halts at the first step that crosses the ceiling, not after all steps', async () => {
    const step1 = makeStep(procId(), {
      totalCost: 0.02,
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const step2Ran: { called: boolean } = { called: false };
    const step2: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(_input) {
        step2Ran.called = true;
        return ok('out2');
      },
    };

    const result = await runComposer({
      pipelineId: 'pk_pipe_ceiling_halt',
      steps: [step1, step2],
      initialInput: 'in',
      budgetCeiling: { maxDollars: 0.01 },
    });

    expect(result.error?.code).toBe('runtime_budget_exceeded');
    expect(step2Ran.called).toBe(false);
  });

  it('runs without ceiling check when budgetCeiling is undefined', async () => {
    const step = makeStep(procId(), {
      totalCost: 999,
      inputTokens: 9999,
      outputTokens: 9999,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const result = await runComposer({
      pipelineId: 'pk_pipe_no_ceiling',
      steps: [step],
      initialInput: 'in',
    });
    expect(result.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property tests (fast-check)
// ---------------------------------------------------------------------------

describe('Property tests — recomputeAccumulation', () => {
  it('replay determinism: same steps[] always produces identical BudgetAccumulation', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            totalCost: fc.integer({ min: 0, max: 10000 }),
            inputTokens: fc.integer({ min: 0, max: 10000 }),
            outputTokens: fc.integer({ min: 0, max: 10000 }),
            cacheWriteTokens: fc.integer({ min: 0, max: 1000 }),
            cacheReadTokens: fc.integer({ min: 0, max: 1000 }),
          }),
          { maxLength: 10 },
        ),
        (costEvents) => {
          const steps = costEvents.map((ce) =>
            makeStep(procId(), {
              totalCost: ce.totalCost / 100_000,
              inputTokens: ce.inputTokens,
              outputTokens: ce.outputTokens,
              cacheWriteTokens: ce.cacheWriteTokens,
              cacheReadTokens: ce.cacheReadTokens,
            }),
          );
          const acc1 = recomputeAccumulation(steps);
          const acc2 = recomputeAccumulation(steps);
          return JSON.stringify(acc1) === JSON.stringify(acc2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('totalRequests always equals steps.length regardless of costEvent presence', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 20 }), (hasCostEvents) => {
        const steps = hasCostEvents.map((hasCe) =>
          makeStep(
            procId(),
            hasCe
              ? {
                  totalCost: 0.01,
                  inputTokens: 1,
                  outputTokens: 1,
                  cacheWriteTokens: 0,
                  cacheReadTokens: 0,
                }
              : undefined,
          ),
        );
        const acc = recomputeAccumulation(steps);
        return acc.totalRequests === steps.length;
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property tests — evaluateBudgetCeiling', () => {
  // Use integer counts for request axis to avoid float imprecision in fc.float constraints
  const arbAccumulation = fc.record({
    totalDollars: fc.integer({ min: 0, max: 100_000 }),
    totalInputTokens: fc.integer({ min: 0, max: 1_000_000 }),
    totalOutputTokens: fc.integer({ min: 0, max: 1_000_000 }),
    totalRequests: fc.integer({ min: 0, max: 10_000 }),
  });

  it('ceiling enforcement: if any axis current >= limit, verdict is exceeded', () => {
    fc.assert(
      fc.property(
        arbAccumulation,
        fc.integer({ min: 1, max: 10_000 }), // requestLimit
        (acc, requestLimit) => {
          // Use totalRequests axis (integer) to avoid float precision issues
          const forcedAcc: BudgetAccumulation = { ...acc, totalRequests: requestLimit };
          const result = evaluateBudgetCeiling(forcedAcc, { maxRequests: requestLimit });
          return result.status === 'exceeded';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('warn-then-halt ordering: exceeded => warn (whenever exceeded triggers, warn fraction also reached)', () => {
    // If current >= limit, then fraction = current/limit >= 1 >= any warnAtFraction < 1.
    // Evaluator prioritises exceeded over warn, but the warn fraction invariant still holds.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }), // limit (requests)
        fc.integer({ min: 1, max: 79 }), // warnPct (1..79 => 0.01..0.79)
        (limit, warnPct) => {
          const warnAt = warnPct / 100;
          const acc = zeroAcc({ totalRequests: limit }); // current === limit => exceeded
          const ceilingWithWarn: BudgetCeiling = { maxRequests: limit, warnAtFraction: warnAt };
          const result = evaluateBudgetCeiling(acc, ceilingWithWarn);
          // Must be exceeded (not warn) because exceeded takes priority
          if (result.status !== 'exceeded') return false;
          // Verify: fraction = limit/limit = 1 >= warnAt — warn invariant holds.
          const fraction = limit / limit;
          return fraction >= warnAt;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('ok is returned when all axes are strictly below limits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000 }), // current requests
        fc.integer({ min: 1, max: 5_000 }), // extra to add to limit
        (current, extra) => {
          const limit = current + extra + 1; // limit strictly > current
          const acc = zeroAcc({ totalRequests: current });
          // Use warnAtFraction > 1 so warn never triggers (fraction is always <= 1).
          // This guarantees the result is always 'ok' when current < limit.
          const safeCeiling: BudgetCeiling = { maxRequests: limit, warnAtFraction: 1.1 };
          const result = evaluateBudgetCeiling(acc, safeCeiling);
          return result.status === 'ok';
        },
      ),
      { numRuns: 200 },
    );
  });
});

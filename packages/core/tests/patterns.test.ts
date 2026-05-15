import { describe, expectTypeOf, it } from 'vitest';
import type { Gate, Aggregate, AgentProcess } from '../src/patterns.js';
import type { Process } from '../src/stages/process.js';

describe('Pattern type aliases', () => {
  it('Gate<I> is assignable to Process<I, I>', () => {
    expectTypeOf<Gate<string>>().toMatchTypeOf<Process<string, string>>();
  });

  it('Process<I, I> is assignable to Gate<I>', () => {
    expectTypeOf<Process<string, string>>().toMatchTypeOf<Gate<string>>();
  });

  it('Aggregate<I, O> is assignable to Process<I[], O>', () => {
    expectTypeOf<Aggregate<string, number>>().toMatchTypeOf<Process<string[], number>>();
  });

  it('AgentProcess<I, O> is assignable to Process<I, O>', () => {
    expectTypeOf<AgentProcess<string, number>>().toMatchTypeOf<Process<string, number>>();
  });

  it('Process<I, O> is assignable to AgentProcess<I, O>', () => {
    expectTypeOf<Process<string, number>>().toMatchTypeOf<AgentProcess<string, number>>();
  });
});

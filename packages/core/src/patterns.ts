import type { Process } from './stages/process.js';

/** A Process whose output type equals its input type. Pass-through-or-reject pattern. */
export type Gate<I> = Process<I, I>;

/** A Process that collapses an array of inputs into a single output. */
export type Aggregate<I, O> = Process<I[], O>;

/** Naming convention for agent-backed Process. Assignable to Process<I,O> with zero coercion. */
export type AgentProcess<I, O> = Process<I, O>;

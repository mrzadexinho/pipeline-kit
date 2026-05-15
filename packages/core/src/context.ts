import { type Context, ROOT_CONTEXT } from '@opentelemetry/api';
import { run } from './ids.js';
import { type UsageAccumulator, createUsageAccumulator } from './usage.js';

export type TraceContext = Context;

export interface MemoryAdapter {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PipelineContext {
  readonly runId: string;
  readonly pipelineId: string;
  /** undefined means non-durable (no retry engine). Defined means attempt number within durable run. */
  readonly attempt?: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly trace: TraceContext;
  readonly idempotencyKey?: string;
  /** @deprecated Use deps.memory instead */
  readonly memory?: MemoryAdapter;
  readonly deps: Readonly<Record<string, unknown>>;
  readonly usage: UsageAccumulator;
  attachMetadata(key: string, value: unknown): void;
}

export interface CreateContextOpts {
  pipelineId: string;
  runId?: string;
  attempt?: number;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  trace?: TraceContext;
  idempotencyKey?: string;
  memory?: MemoryAdapter;
  deps?: Record<string, unknown>;
  usage?: UsageAccumulator;
}

export function deriveAtomCtx(parent: PipelineContext, idempotencyKey: string): PipelineContext {
  return {
    get runId() {
      return parent.runId;
    },
    get pipelineId() {
      return parent.pipelineId;
    },
    get attempt() {
      return parent.attempt;
    },
    get metadata() {
      return parent.metadata;
    },
    get signal() {
      return parent.signal;
    },
    get trace() {
      return parent.trace;
    },
    idempotencyKey,
    get memory() {
      return parent.memory;
    },
    get deps() {
      return parent.deps;
    },
    get usage() {
      return parent.usage;
    },
    attachMetadata(key, value) {
      parent.attachMetadata(key, value);
    },
  };
}

export function createContext(opts: CreateContextOpts): PipelineContext {
  const internalMetadata: Record<string, unknown> = { ...opts.metadata };

  return {
    runId: opts.runId ?? run(),
    pipelineId: opts.pipelineId,
    attempt: opts.attempt,
    get metadata() {
      return internalMetadata;
    },
    signal: opts.signal ?? new AbortController().signal,
    trace: opts.trace ?? ROOT_CONTEXT,
    idempotencyKey: opts.idempotencyKey,
    memory: opts.memory,
    deps: Object.freeze({ ...opts.deps }),
    usage: opts.usage ?? createUsageAccumulator(),
    attachMetadata(key, value) {
      internalMetadata[key] = value;
    },
  };
}

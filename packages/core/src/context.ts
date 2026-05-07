import { type Context, ROOT_CONTEXT } from '@opentelemetry/api';
import { run } from './ids.js';

export type TraceContext = Context;

export interface MemoryAdapter {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PipelineContext {
  readonly runId: string;
  readonly pipelineId: string;
  readonly attempt: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly trace: TraceContext;
  readonly idempotencyKey?: string;
  readonly memory?: MemoryAdapter;
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
}

export function createContext(opts: CreateContextOpts): PipelineContext {
  const internalMetadata: Record<string, unknown> = { ...opts.metadata };

  return {
    runId: opts.runId ?? run(),
    pipelineId: opts.pipelineId,
    attempt: opts.attempt ?? 1,
    get metadata() {
      return internalMetadata;
    },
    signal: opts.signal ?? new AbortController().signal,
    trace: opts.trace ?? ROOT_CONTEXT,
    idempotencyKey: opts.idempotencyKey,
    memory: opts.memory,
    attachMetadata(key, value) {
      internalMetadata[key] = value;
    },
  };
}

# pipeline-kit — Phase 2 Spec — §1 API Surface (v0)

> Drilldown for [spec.md](spec.md). Concrete TypeScript signatures for all
> exported types in `@pipeline-kit/core`. Authoritative for kit's public
> v0 API. Anchors back to the ADRs that drove each decision.
>
> **Author:** Brain — 2026-05-06.

---

## Factory + types

```typescript
// Factory (Supabase pattern; ADR16 + ADR23)
export function createPipelineKit(config?: ClientConfig): PipelineKitClient;

interface ClientConfig {
  apiKey?: string;       // env fallback: PIPELINE_KIT_API_KEY
  url?: string;          // env fallback: PIPELINE_KIT_URL
  memory?: MemoryAdapter;  // optional cross-run memory backend (orchestr8)
  timeout?: number;      // ms; default 30_000
  retryPolicy?: Partial<RetryPolicy>;  // global default per ADR13
}

interface PipelineKitClient {
  pipelines: PipelinesResource;
  runs: RunsResource;
  atoms: AtomsResource;
  webhooks: WebhooksResource;
}
```

## Result<T, E> contract (ADR4)

```typescript
export type Result<T, E = ErrorEnvelope> =
  | { data: T; error: null }
  | { data: null; error: E };
```

## Stage interfaces (Source / Store / Process / Serve)

```typescript
// Source<O>: pull-style data emitter (ADR2 + ADR7)
export interface Source<O> {
  readonly id: string;          // pk_src_<id>
  readonly schema: ZodSchema<O>;  // ADR6 boundary validation
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly rateLimit?: TokenBucketConfig;
  iter(query: SourceQuery, ctx: PipelineContext): AsyncIterable<Atom<O>>;
  fetch(query: SourceQuery, ctx: PipelineContext): Promise<Result<Atom<O>[], SourceError>>;
}

// Store<T>: stateful atom persistence; idempotency-aware (ADR9)
export interface Store<T> {
  readonly id: string;          // pk_store_<id>
  readonly schema: ZodSchema<T>;
  put(atom: Atom<T>, ctx: PipelineContext): Promise<Result<Atom<T>, StoreError>>;
  get(id: string, ctx: PipelineContext): Promise<Result<Atom<T> | null, StoreError>>;
  list(filters: StoreFilters, ctx: PipelineContext): Promise<Result<ListResult<Atom<T>>, StoreError>>;
}

// Process<I, O>: pure transformation (ADR4)
export interface Process<I, O> {
  readonly id: string;          // pk_proc_<id>
  readonly inputSchema?: ZodSchema<I>;   // optional internal validation
  readonly outputSchema?: ZodSchema<O>;
  readonly retryPolicy?: Partial<RetryPolicy>;
  run(input: I, ctx: PipelineContext): Promise<Result<O, ProcessError>>;
}

// Serve<I>: side-effecting emission; idempotency mandatory if mutating (ADR9)
export interface Serve<I> {
  readonly id: string;          // pk_serve_<id>
  readonly schema: ZodSchema<I>;
  readonly idempotencySupport: 'required' | 'optional' | 'unsupported';
  readonly retryPolicy?: Partial<RetryPolicy>;
  readonly rateLimit?: TokenBucketConfig;
  emit(input: I, ctx: PipelineContext): Promise<Result<EmitResult, ServeError>>;
}
```

## Atom<T> (data unit)

```typescript
export interface Atom<T> extends ResourceEnvelope {
  id: string;             // pk_atom_<ulid>
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
  source_id?: string;     // pk_src_<id> emitter
  stage_id?: string;      // current stage in pipeline
  run_id?: string;        // pk_run_<ulid>
}
```

## PipelineContext (ADR5)

```typescript
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
```

## Pipeline composition (ADR12)

```typescript
export const Pipeline: {
  from<O>(source: Source<O>): SourcePipeline<O>;
};

export interface SourcePipeline<O> {
  through<Out>(process: Process<O, Out>): SourcePipeline<Out>;
  store(store: Store<O>): SourcePipeline<O>;
  review(reviewable: Reviewable<O>): SourcePipeline<O>;
  to(serve: Serve<O>): TerminalPipeline<O>;
  describe(): PipelineDefinition;
}

export interface TerminalPipeline<O> {
  run(input?: unknown, options?: RunOptions): Promise<Result<RunResult<O>, RunError>>;
  describe(): PipelineDefinition;
}

export interface RunOptions {
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  context?: Partial<PipelineContext>;
}

export interface RunResult<O> {
  runId: string;
  pipelineId: string;
  output: O;
  atomCount: number;
  duration: number;
  metadata: Record<string, unknown>;
}
```

## Reviewable<I> (ADR14)

> **Lock 1 (M0 + M0.5):** `Reviewable<I>` is a peer of `Process<I, O>`, not a
> generalisation of it. Position-locked at `.review()` in the pipeline DSL;
> for Process-shaped composition use `reviewableToProcess(reviewable)` (ships
> in `@pipeline-kit/core`). The decision union (`approved | rejected | retry
> | ignored`) and the orchestrator semantics around each decision are
> stable across M0 / M0.5 — adapters under `@pipeline-kit/process-reviewable`
> are wrappers, not redefinitions.

```typescript
export interface ReviewableConfig {
  allowApprove: boolean;
  allowReject: boolean;
  allowEdit: boolean;
  allowRetry: boolean;
  allowIgnore: boolean;
}

export type ReviewResponse<I> =
  | { decision: 'approved'; value: I; wasEdited: boolean; reviewer?: string }
  | { decision: 'rejected'; reason?: string; reviewer?: string }
  | { decision: 'retry'; feedback?: string; reviewer?: string }
  | { decision: 'ignored'; reason?: string };

export interface Reviewable<I> {
  readonly id: string;
  readonly config: ReviewableConfig;
  describe(input: I): string;
  review(input: I, ctx: PipelineContext): Promise<Result<ReviewResponse<I>[], ReviewError>>;
}
```

## EditableField<T> (ADR19)

```typescript
export interface EditableField<T> {
  readonly suggested: T;
  readonly approved: T | null;
  readonly wasEdited: boolean;
}

export const Field: {
  unedited<T>(value: T): EditableField<T>;
  edited<T>(suggested: T, approved: T): EditableField<T>;
  rejected<T>(suggested: T): EditableField<T>;
};
```

## Audited<I, O> (ADR18)

```typescript
export function Audited<I, O>(
  inner: Process<I, O>,
  config: { backend: AuditAdapter; redact?: (v: unknown) => unknown }
): Process<I, O>;

export interface AuditAdapter {
  emit(entry: AuditEntry): Promise<Result<void, AuditError>>;
}

export interface AuditEntry {
  id: string;
  pipeline_id: string;
  run_id: string;
  stage_id: string;
  input: unknown;
  output: unknown;
  decision?: ReviewResponse<unknown>;
  signature: string;
  created_at: string;
  metadata: Record<string, unknown>;
}
```

## Webhook helpers (ADR17 + ADR21)

```typescript
export const webhooks: {
  verify(rawBody: string, sigHeader: string, secret: string, options?: VerifyOptions): Result<PipelineKitEvent, WebhookError>;
  sign(payload: string, secret: string, options?: SignOptions): string;
};

export interface VerifyOptions {
  tolerance?: number;             // ms; default 300_000 (5 min)
  acceptedAlgorithms?: ('v1' | 'v2')[];  // default ['v1']  (algorithm version inside header value, per ADR21)
}

export interface SignOptions {
  timestamp?: Date;               // default now
  algorithm?: 'v1' | 'v2';        // default 'v1'  (Stripe-canon: single header X-Pipeline-Kit-Signature with algorithm version inside value)
}

export type PipelineKitEvent =
  | { type: 'pipeline.run.created'; data: RunCreatedData }
  | { type: 'pipeline.run.completed'; data: RunCompletedData }
  | { type: 'pipeline.run.failed'; data: RunFailedData }
  | { type: 'review.created'; data: ReviewCreatedData }
  | { type: 'review.decided'; data: ReviewDecidedData };
```

## Error envelope (ADR16)

```typescript
export interface ErrorEnvelope {
  type: string;
  code: string;
  message: string;
  param?: string;
  doc_url?: string;
  request_id?: string;
}
```

---

*End of §1 API surface. See [spec.md](spec.md) for ADRs 1-23,
[spec-adapters.md](spec-adapters.md) for §2 reference adapter list,
[spec-build-plan.md](spec-build-plan.md) for §3 test plan + §4 roadmap +
§5 deferred questions.*

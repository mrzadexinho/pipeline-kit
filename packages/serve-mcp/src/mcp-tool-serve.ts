import {
  err,
  ok,
  type EmitResult,
  type PipelineContext,
  type Result,
  type RetryPolicy,
  type Serve,
  type ServeError,
  type TerminalPipeline,
} from '@pipeline-kit/core';
import { toJSONSchema, type ZodType } from 'zod';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface McpToolServeConfig<I, O> {
  id?: string;
  toolName: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  pipeline: TerminalPipeline<O>;
  retryPolicy?: Partial<RetryPolicy>;
}

export interface McpToolHandlerResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolRegistration<_I> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown) => Promise<McpToolHandlerResponse>;
}

export interface McpToolServe<I, O> extends Serve<I> {
  readonly toolRegistration: McpToolRegistration<I>;
  // Phantom slot so the O type parameter is structurally referenced and
  // can be inferred from config without forcing users to spell it out.
  readonly _outputType?: O;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `pk_serve_mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeServeError(
  type: ServeError['type'],
  code: string,
  message: string,
  metadata?: Record<string, unknown>,
): ServeError {
  const base: { type: string; code: string; message: string; metadata?: Record<string, unknown> } =
    { type, code, message };
  if (metadata !== undefined) {
    base.metadata = metadata;
  }
  return base as ServeError;
}

function describeZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  return issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)';
      return `${path}: ${i.message}`;
    })
    .join('; ');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMcpToolServe<I, O>(
  config: McpToolServeConfig<I, O>,
): McpToolServe<I, O> {
  if (!config.toolName || config.toolName.trim().length === 0) {
    throw new Error('McpToolServe: toolName is required.');
  }
  if (!config.description || config.description.trim().length === 0) {
    throw new Error('McpToolServe: description is required.');
  }

  const id = config.id ?? generateId();
  const inputJsonSchema = toJSONSchema(config.inputSchema) as Record<string, unknown>;

  const emit = async (
    input: I,
    ctx: PipelineContext,
  ): Promise<Result<EmitResult, ServeError>> => {
    // 1. Validate input
    const parsed = config.inputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        makeServeError(
          'validation',
          'mcp_validation_error',
          describeZodIssues(parsed.error.issues),
        ),
      );
    }

    // 2. Run the pipeline
    const result = await config.pipeline.run(parsed.data, { signal: ctx.signal });

    // 3. Translate run errors
    if (result.error !== null) {
      const runError = result.error;
      const message =
        typeof runError.message === 'string' && runError.message.length > 0
          ? runError.message
          : 'pipeline failed';
      return err(
        makeServeError('unknown', 'pipeline_error', message, { runError }),
      );
    }

    const data = result.data;
    return ok({
      id: data.runId,
      emitted_at: new Date().toISOString(),
      metadata: { atomCount: data.atomCount, duration: data.duration },
    });
  };

  const handler = async (input: unknown): Promise<McpToolHandlerResponse> => {
    const parsed = config.inputSchema.safeParse(input);
    if (!parsed.success) {
      const message = describeZodIssues(parsed.error.issues);
      return {
        content: [{ type: 'text', text: `Invalid input: ${message}` }],
        isError: true,
      };
    }

    const controller = new AbortController();
    const result = await config.pipeline.run(parsed.data, { signal: controller.signal });
    if (result.error !== null) {
      const message =
        typeof result.error.message === 'string' && result.error.message.length > 0
          ? result.error.message
          : 'pipeline failed';
      return {
        content: [{ type: 'text', text: `Pipeline error: ${message}` }],
        isError: true,
      };
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(result.data);
    } catch {
      serialized = String(result.data);
    }

    return {
      content: [{ type: 'text', text: serialized }],
    };
  };

  const toolRegistration: McpToolRegistration<I> = {
    name: config.toolName,
    description: config.description,
    inputSchema: inputJsonSchema,
    handler,
  };

  const serve: McpToolServe<I, O> = {
    id,
    schema: config.inputSchema,
    idempotencySupport: 'unsupported',
    ...(config.retryPolicy !== undefined ? { retryPolicy: config.retryPolicy } : {}),
    emit,
    toolRegistration,
  };

  return serve;
}

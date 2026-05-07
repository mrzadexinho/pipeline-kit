import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  type Atom,
  atom,
  err,
  ok,
  type PipelineContext,
  type Result,
  type RetryPolicy,
  type Source,
  type SourceError,
  type SourceQuery,
  src,
  type TokenBucketConfig,
} from '@pipeline-kit/core';
import { type ZodType, z } from 'zod';
import { deriveZodFromJsonSchema } from './schema-derive.js';

export type McpToolSourceConfig<O> = {
  id?: string;
  serverUrl: string;
  toolName: string;
  args: Record<string, unknown>;
  schema?: ZodType<O>;
  expectArray?: boolean;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
};

type ResolvedMcpConfig<O> = McpToolSourceConfig<O> & {
  id: string;
  schema: ZodType<O>;
};

function makeAtom<O>(data: O, config: ResolvedMcpConfig<O>, ctx: PipelineContext): Atom<O> {
  return {
    id: atom(),
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: {},
    data,
    source_id: config.id,
    run_id: ctx.runId,
  };
}

function transientError(message: string): SourceError {
  return { type: 'transient', code: 'mcp_transport_error', message };
}

function validationError(message: string): SourceError {
  return { type: 'validation', code: 'mcp_tool_error', message };
}

function timeoutError(message: string): SourceError {
  return { type: 'timeout', code: 'mcp_timeout', message };
}

/**
 * Derives a schema from the MCP server's tool output schema.
 * If `config.schema` is provided, it takes precedence.
 */
async function resolveSchema<O>(
  config: McpToolSourceConfig<O>,
  client: Client,
): Promise<ZodType<O>> {
  if (config.schema) {
    return config.schema;
  }

  try {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === config.toolName);
    if (tool?.outputSchema) {
      return deriveZodFromJsonSchema(tool.outputSchema) as ZodType<O>;
    }
  } catch {
    // Fallback to z.unknown() if listTools fails
  }

  return z.unknown() as ZodType<O>;
}

/**
 * Extracts parsed content items from a callTool result.
 * Finds all text content items, JSON-parses them.
 */
function extractContent(
  result: Awaited<ReturnType<Client['callTool']>>,
): { success: true; items: unknown[] } | { success: false; error: string } {
  if (!('content' in result) || !Array.isArray(result.content)) {
    return { success: false, error: 'No content array in tool result' };
  }

  const parsed: unknown[] = [];

  for (const item of result.content) {
    if (
      item !== null &&
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'text' &&
      'text' in item &&
      typeof item.text === 'string'
    ) {
      try {
        const value = JSON.parse(item.text) as unknown;
        parsed.push(value);
      } catch {
        // Non-JSON text item — push raw string
        parsed.push(item.text);
      }
    }
  }

  return { success: true, items: parsed };
}

async function connectClient(
  config: ResolvedMcpConfig<unknown>,
): Promise<{ success: true; client: Client } | { success: false; error: SourceError }> {
  const client = new Client({ name: 'pipeline-kit', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl));

  try {
    await client.connect(transport);
    return { success: true, client };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const isTimeout =
      message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out');
    const error = isTimeout ? timeoutError(message) : transientError(message);
    return { success: false, error };
  }
}

async function* iterAtoms<O>(
  config: ResolvedMcpConfig<O>,
  query: SourceQuery,
  ctx: PipelineContext,
): AsyncGenerator<Atom<O>> {
  if (ctx.signal.aborted) return;

  const connectResult = await connectClient(config as ResolvedMcpConfig<unknown>);
  if (!connectResult.success) {
    throw Object.assign(new Error(connectResult.error.message), {
      sourceError: connectResult.error,
    });
  }

  const { client } = connectResult;

  try {
    const resolvedSchema = await resolveSchema(config, client);

    if (ctx.signal.aborted) return;

    const mergedArgs: Record<string, unknown> = {
      ...config.args,
      ...(query ?? {}),
    };

    let toolResult: Awaited<ReturnType<Client['callTool']>>;
    try {
      toolResult = await client.callTool({ name: config.toolName, arguments: mergedArgs });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const isTimeout =
        message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out');
      const error = isTimeout ? timeoutError(message) : transientError(message);
      throw Object.assign(new Error(message), { sourceError: error });
    }

    if (toolResult.isError === true) {
      throw Object.assign(
        new Error(
          'content' in toolResult && Array.isArray(toolResult.content)
            ? String(toolResult.content[0])
            : 'MCP tool returned an error',
        ),
        { sourceError: validationError('MCP tool returned isError=true') },
      );
    }

    const extracted = extractContent(toolResult);
    if (!extracted.success) {
      throw Object.assign(new Error(extracted.error), {
        sourceError: validationError(extracted.error),
      });
    }

    const { items } = extracted;

    if (config.expectArray === true) {
      // Expect items[0] to be an array, unpack each element
      const firstItem = items[0];
      const arr = Array.isArray(firstItem) ? firstItem : items;

      for (const element of arr) {
        if (ctx.signal.aborted) return;
        const parsed = resolvedSchema.safeParse(element);
        if (parsed.success) {
          yield makeAtom(parsed.data, config, ctx);
        }
      }
    } else {
      // Single atom — use first item
      if (items.length > 0) {
        const parsed = resolvedSchema.safeParse(items[0]);
        if (parsed.success) {
          yield makeAtom(parsed.data, config, ctx);
        }
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function fetchAtoms<O>(
  config: ResolvedMcpConfig<O>,
  query: SourceQuery,
  ctx: PipelineContext,
): Promise<Result<Atom<O>[], SourceError>> {
  const atoms: Atom<O>[] = [];

  try {
    for await (const a of iterAtoms(config, query, ctx)) {
      atoms.push(a);
    }
    return ok(atoms);
  } catch (e) {
    if (e !== null && typeof e === 'object' && 'sourceError' in e) {
      return err(e.sourceError as SourceError);
    }
    const message = e instanceof Error ? e.message : String(e);
    return err(transientError(message));
  }
}

export function createMcpToolSource<O>(config: McpToolSourceConfig<O>): Source<O> {
  const resolvedId = config.id ?? src();
  const resolvedConfig: ResolvedMcpConfig<O> = {
    ...config,
    id: resolvedId,
    schema: config.schema ?? (z.unknown() as ZodType<O>),
  };

  async function* iterImpl(query: SourceQuery, ctx: PipelineContext): AsyncIterable<Atom<O>> {
    yield* iterAtoms(resolvedConfig, query, ctx);
  }

  async function fetchImpl(
    query: SourceQuery,
    ctx: PipelineContext,
  ): Promise<Result<Atom<O>[], SourceError>> {
    return fetchAtoms(resolvedConfig, query, ctx);
  }

  return {
    id: resolvedId,
    schema: resolvedConfig.schema,
    retryPolicy: config.retryPolicy,
    rateLimit: config.rateLimit,
    iter: iterImpl,
    fetch: fetchImpl,
  };
}

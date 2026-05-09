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
} from '@idriszade/core';
import { type ZodType, z } from 'zod';
import { httpStatusToSourceError, networkError, parseRetryAfter } from './errors.js';
import {
  advanceState,
  applyPaginationParams,
  initialState,
  type PageBody,
  type PaginationState,
} from './pagination.js';

export type AuthConfig =
  | { type: 'bearer'; value: string }
  | { type: 'apiKey'; header: string; value: string }
  | { type: 'basic'; user: string; password: string }
  | { type: 'none' };

export type PaginateConfig =
  | { type: 'cursor'; cursorField: string; cursorParam: string }
  | { type: 'offset'; pageSize: number; offsetParam: string }
  | { type: 'page'; pageSize: number; pageParam: string }
  | { type: 'none' };

export interface ApiSourceConfig<O> {
  id?: string;
  baseUrl: string;
  endpoint: string;
  method?: 'GET' | 'POST';
  auth?: AuthConfig;
  paginate?: PaginateConfig;
  schema: ZodType<O>;
  responseShape?: 'array' | 'wrapped';
  responsePath?: string;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
}

const AuthConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer'), value: z.string() }),
  z.object({ type: z.literal('apiKey'), header: z.string(), value: z.string() }),
  z.object({ type: z.literal('basic'), user: z.string(), password: z.string() }),
  z.object({ type: z.literal('none') }),
]);

const PaginateConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cursor'), cursorField: z.string(), cursorParam: z.string() }),
  z.object({
    type: z.literal('offset'),
    pageSize: z.number().int().positive(),
    offsetParam: z.string(),
  }),
  z.object({
    type: z.literal('page'),
    pageSize: z.number().int().positive(),
    pageParam: z.string(),
  }),
  z.object({ type: z.literal('none') }),
]);

const ApiSourceConfigSchema = z.object({
  id: z.string().optional(),
  baseUrl: z.string().url(),
  endpoint: z.string(),
  method: z.enum(['GET', 'POST']).optional(),
  auth: AuthConfigSchema.optional(),
  paginate: PaginateConfigSchema.optional(),
  schema: z.custom<ZodType<unknown>>(
    (v) => v != null && typeof (v as Record<string, unknown>).parse === 'function',
  ),
  responseShape: z.enum(['array', 'wrapped']).optional(),
  responsePath: z.string().optional(),
  retryPolicy: z.record(z.string(), z.unknown()).optional(),
  rateLimit: z
    .object({
      capacity: z.number(),
      refillRate: z.number(),
      intervalMs: z.number(),
    })
    .optional(),
});

function buildAuthHeaders(auth?: AuthConfig): Record<string, string> {
  if (!auth || auth.type === 'none') return {};
  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.value}` };
    case 'apiKey':
      return { [auth.header]: auth.value };
    case 'basic': {
      const encoded = btoa(`${auth.user}:${auth.password}`);
      return { Authorization: `Basic ${encoded}` };
    }
  }
}

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur !== null && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      return (cur as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function extractItems(body: unknown, config: ApiSourceConfig<unknown>): unknown[] {
  const shape = config.responseShape ?? 'array';
  if (shape === 'array') {
    return Array.isArray(body) ? body : [];
  }
  if (config.responsePath) {
    const found = resolvePath(body, config.responsePath);
    return Array.isArray(found) ? found : [];
  }
  if (body !== null && typeof body === 'object' && 'items' in (body as Record<string, unknown>)) {
    const items = (body as Record<string, unknown>).items;
    return Array.isArray(items) ? items : [];
  }
  return [];
}

function extractNextCursor(
  body: unknown,
  config: ApiSourceConfig<unknown>,
): string | null | undefined {
  if (config.responseShape !== 'wrapped') return null;
  if (body !== null && typeof body === 'object') {
    const wrapped = body as Record<string, unknown>;
    if ('next_cursor' in wrapped) {
      const nc = wrapped.next_cursor;
      return typeof nc === 'string' ? nc : null;
    }
    if (
      config.paginate &&
      config.paginate.type === 'cursor' &&
      config.paginate.cursorField in wrapped
    ) {
      const nc = wrapped[config.paginate.cursorField];
      return typeof nc === 'string' ? nc : null;
    }
  }
  return null;
}

async function fetchPage(
  config: ApiSourceConfig<unknown>,
  state: PaginationState,
  signal: AbortSignal,
): Promise<Result<{ items: unknown[]; pageBody: unknown }, SourceError>> {
  const url = new URL(config.endpoint, config.baseUrl);
  applyPaginationParams(url, state, config);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...buildAuthHeaders(config.auth),
  };

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: config.method ?? 'GET',
      headers,
      signal,
    });
  } catch (e) {
    return err(networkError(e instanceof Error ? e.message : String(e)));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const sourceErr = httpStatusToSourceError(response.status, body);
    if (response.status === 429) {
      const retry_after_ms = parseRetryAfter(response.headers);
      return err({
        ...sourceErr,
        ...(retry_after_ms !== undefined ? { retry_after_ms } : {}),
      } as SourceError);
    }
    return err(sourceErr);
  }

  let parsed: unknown;
  try {
    parsed = (await response.json()) as unknown;
  } catch (e) {
    return err(
      networkError(`Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  const items = extractItems(parsed, config);
  const next_cursor = extractNextCursor(parsed, config);
  return ok({ items, pageBody: { items, next_cursor } });
}

function makeAtom<O>(data: O, config: ApiSourceConfig<O>, ctx: PipelineContext): Atom<O> {
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

export function createApiSource<O>(config: ApiSourceConfig<O>): Source<O> {
  const parsed = ApiSourceConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid ApiSourceConfig: ${parsed.error.message}`);
  }

  const resolvedId = config.id ?? src();
  const resolvedConfig: ApiSourceConfig<O> = { ...config, id: resolvedId };

  async function* iterImpl(_query: SourceQuery, ctx: PipelineContext): AsyncIterable<Atom<O>> {
    let state = initialState(resolvedConfig as ApiSourceConfig<unknown>);

    while (!state.done) {
      if (ctx.signal.aborted) return;

      const result = await fetchPage(resolvedConfig as ApiSourceConfig<unknown>, state, ctx.signal);

      if (result.error !== null) {
        return;
      }

      const { items, pageBody } = result.data;

      for (const item of items) {
        const validation = resolvedConfig.schema.safeParse(item);
        if (!validation.success) {
          continue;
        }
        yield makeAtom(validation.data as O, resolvedConfig, ctx);
      }

      state = advanceState(state, resolvedConfig as ApiSourceConfig<unknown>, pageBody as PageBody);
    }
  }

  async function fetchImpl(
    _query: SourceQuery,
    ctx: PipelineContext,
  ): Promise<Result<Atom<O>[], SourceError>> {
    let state = initialState(resolvedConfig as ApiSourceConfig<unknown>);
    const atoms: Atom<O>[] = [];

    while (!state.done) {
      if (ctx.signal.aborted) break;

      const result = await fetchPage(resolvedConfig as ApiSourceConfig<unknown>, state, ctx.signal);

      if (result.error !== null) {
        return err(result.error);
      }

      const { items, pageBody } = result.data;

      for (const item of items) {
        const validation = resolvedConfig.schema.safeParse(item);
        if (!validation.success) {
          continue;
        }
        atoms.push(makeAtom(validation.data as O, resolvedConfig, ctx));
      }

      state = advanceState(state, resolvedConfig as ApiSourceConfig<unknown>, pageBody as PageBody);
    }

    return ok(atoms);
  }

  return {
    id: resolvedId,
    schema: resolvedConfig.schema,
    retryPolicy: resolvedConfig.retryPolicy,
    rateLimit: resolvedConfig.rateLimit,
    iter: iterImpl,
    fetch: fetchImpl,
  };
}

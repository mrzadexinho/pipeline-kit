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
import { ApifyClient } from 'apify-client';
import type { ZodType } from 'zod';
import { paginateDataset } from './dataset-paginate.js';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 300_000;

export interface ApifySourceConfig<O> {
  id?: string;
  actorId: string;
  input: Record<string, unknown>;
  schema: ZodType<O>;
  datasetMode?: 'append' | 'reset';
  apifyToken: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
}

type RunStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED-OUT'
  | 'ABORTED'
  | 'RUNNING'
  | 'READY'
  | 'ABORTING';

function makeAtom<O>(data: O, config: ApifySourceConfig<O>, ctx: PipelineContext): Atom<O> {
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

function runStatusToSourceError(status: RunStatus): SourceError {
  if (status === 'FAILED' || status === 'TIMED-OUT') {
    return {
      type: 'transient',
      code: `apify_run_${status.toLowerCase().replace('-', '_')}`,
      message: `Apify actor run ended with status: ${status}`,
    };
  }
  if (status === 'ABORTED') {
    return {
      type: 'unavailable',
      code: 'apify_run_aborted',
      message: 'Apify actor run was aborted',
    };
  }
  return {
    type: 'unknown',
    code: 'apify_run_unknown',
    message: `Unexpected run status: ${status}`,
  };
}

async function waitForRun(
  apifyClient: ApifyClient,
  runId: string,
  config: ApifySourceConfig<unknown>,
  signal: AbortSignal,
): Promise<Result<string, SourceError>> {
  const pollMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxMs = config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const deadline = Date.now() + maxMs;

  while (true) {
    if (signal.aborted) {
      return err<SourceError>({
        type: 'unavailable',
        code: 'cancelled',
        message: 'Run cancelled by context signal',
      });
    }

    const run = await apifyClient.run(runId).get();
    if (!run) {
      return err<SourceError>({
        type: 'transient',
        code: 'apify_run_missing',
        message: 'Run record not found',
      });
    }

    const status = run.status as RunStatus;

    if (status === 'SUCCEEDED') {
      return ok(run.defaultDatasetId);
    }

    if (status === 'FAILED' || status === 'TIMED-OUT' || status === 'ABORTED') {
      return err(runStatusToSourceError(status));
    }

    if (Date.now() >= deadline) {
      return err<SourceError>({
        type: 'timeout',
        code: 'apify_poll_timeout',
        message: `Actor run did not complete within ${maxMs}ms`,
      });
    }

    await sleep(pollMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function* collectAtoms<O>(
  apifyClient: ApifyClient,
  config: ApifySourceConfig<O>,
  ctx: PipelineContext,
): AsyncGenerator<Atom<O>> {
  let runId: string;
  try {
    const startedRun = await apifyClient.actor(config.actorId).start(config.input);
    runId = startedRun.id;
  } catch (_e) {
    return;
  }

  const datasetResult = await waitForRun(
    apifyClient,
    runId,
    config as ApifySourceConfig<unknown>,
    ctx.signal,
  );
  if (datasetResult.error !== null) {
    return;
  }

  const datasetId = datasetResult.data;
  const datasetClient = apifyClient.dataset(datasetId);

  for await (const item of paginateDataset(datasetClient)) {
    if (ctx.signal.aborted) return;

    const parsed = config.schema.safeParse(item);
    if (!parsed.success) {
      console.warn(
        '[source-apify] Schema validation failed for item from dataset',
        datasetId,
        ':',
        parsed.error.message,
      );
      continue;
    }

    yield makeAtom(parsed.data, config, ctx);
  }
}

async function collectAtomsToResult<O>(
  apifyClient: ApifyClient,
  config: ApifySourceConfig<O>,
  ctx: PipelineContext,
): Promise<Result<Atom<O>[], SourceError>> {
  let runId: string;
  try {
    const startedRun = await apifyClient.actor(config.actorId).start(config.input);
    runId = startedRun.id;
  } catch (e) {
    return err<SourceError>({
      type: 'network',
      code: 'apify_start_failed',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const datasetResult = await waitForRun(
    apifyClient,
    runId,
    config as ApifySourceConfig<unknown>,
    ctx.signal,
  );
  if (datasetResult.error !== null) {
    return err(datasetResult.error);
  }

  const datasetId = datasetResult.data;
  const datasetClient = apifyClient.dataset(datasetId);
  const atoms: Atom<O>[] = [];

  for await (const item of paginateDataset(datasetClient)) {
    if (ctx.signal.aborted) break;

    const parsed = config.schema.safeParse(item);
    if (!parsed.success) {
      console.warn(
        '[source-apify] Schema validation failed for item from dataset %s: %s',
        datasetId,
        parsed.error.message,
      );
      continue;
    }

    atoms.push(makeAtom(parsed.data, config, ctx));
  }

  return ok(atoms);
}

export function createApifySource<O>(config: ApifySourceConfig<O>): Source<O> {
  const resolvedId = config.id ?? src();
  const resolvedConfig: ApifySourceConfig<O> = { ...config, id: resolvedId };

  const apifyToken = resolvedConfig.apifyToken || process.env.APIFY_TOKEN || '';

  async function* iterImpl(_query: SourceQuery, ctx: PipelineContext): AsyncIterable<Atom<O>> {
    const apifyClient = new ApifyClient({ token: apifyToken });
    yield* collectAtoms(apifyClient, resolvedConfig, ctx);
  }

  async function fetchImpl(
    _query: SourceQuery,
    ctx: PipelineContext,
  ): Promise<Result<Atom<O>[], SourceError>> {
    const apifyClient = new ApifyClient({ token: apifyToken });
    return collectAtomsToResult(apifyClient, resolvedConfig, ctx);
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

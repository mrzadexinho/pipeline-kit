// Cat VIII spike #4 leg-1 — Variant B.2 (re-resolve) under version-aware wrapper.
// Two harnesses run in this file:
//
//   CELL (b) two-site / B.2 + version-aware
//     Mirrors spike-#3 B.2 shape: factory resolves bearer once for HTTP-client
//     construction; signer closure re-resolves on every call via deps.secrets.
//     Difference vs spike #3: the resolver handed in via deps is the
//     version-aware wrapper around a fresh real resolver. The question:
//     does the wrapper collapse the per-atom read inflation observed in
//     spike #3 (3 reads / 2 atoms) down to B.1's read=1 baseline?
//
//   CELL (d) rotation / B.2 + version-aware
//     Mirrors spike-#2 B-CoR rotation harness shape but using the explicit
//     "no adapter cache; resolver wraps; adapter calls resolve every iter"
//     pattern. Difference vs spike #2: deps.secrets is the version-aware
//     wrapper. The question: does the wrapper close the cross-run
//     staleness leak observed in spike #2 §6 for B-CoR — i.e. does the
//     version-stamp re-fetch fire on the rotated value when the next iter
//     comes in?

import {
  type Result,
  type SecretsError,
  type SecretsResolver,
  type SecretStats,
  createMockSecretsResolver,
  err,
  ok,
} from './mock-secrets-resolver.ts';
import {
  type ApifyHttpClient,
  type ApifyHttpError,
  createApifyHttpClient,
  mintCallId,
} from './mock-apify-http-client.ts';
import { createVersionAwareResolver } from './version-aware-resolver.ts';

// --- Shared kit primitives ---
interface Atom<T> {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
}

interface ApifyJobResult {
  jobId: string;
  status: number;
}

interface ApifyJobItem {
  id: string;
  title: string;
  company: string;
}

interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

type ApifySourceError = SecretsError | ApifyHttpError;

interface ApifySourceDeps {
  secrets: SecretsResolver;
}

interface ApifySourceArgs {
  actorId: string;
}

interface SourceTwoSite<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, ApifySourceError>>;
}

interface SourceRotation<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, SecretsError>>;
}

function statsLine(label: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[variant-b2-va] ${label} stats ERR ${s.error.code}`;
  return `[variant-b2-va] ${label} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

// =============================================================================
// CELL (b) — two-site harness, B.2 re-resolve, version-aware wrapper
// =============================================================================

async function createTwoSiteReResolve(
  args: ApifySourceArgs,
  deps: ApifySourceDeps,
): Promise<Result<SourceTwoSite<ApifyJobResult>, ApifySourceError>> {
  const { actorId } = args;
  const { secrets } = deps;

  // Factory-time site: bearer token resolved ONCE for HTTP-client construction.
  const tokenResult = await secrets.resolve('apify-token');
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  // HTTP client: bearer is closed-over from factory; signer re-resolves
  // on every call via deps.secrets — the run-time site (now wrapped).
  const httpClient: ApifyHttpClient = createApifyHttpClient({
    bearerToken: tokenAtFactory,
    signRequest: async (atomId) => {
      const live = await secrets.resolve('apify-token');
      if (live.error !== null) {
        return err({
          type: 'apify_http_error',
          code: 'signer_failed',
          message: `signer could not resolve apify-token: ${live.error.message}`,
          param: 'apify-token',
        });
      }
      return ok(mintCallId(live.data, atomId));
    },
  });

  return ok({
    id: 'pk_src_apify_variant_b2_va',
    async *iter(ctx) {
      const atomIds = ['pk_atom_VARIANT_B2_VA_01', 'pk_atom_VARIANT_B2_VA_02'];
      for (const atomId of atomIds) {
        const before = secrets.stats('apify-token');
        const beforeReads = before.error !== null ? -1 : before.data.reads;
        console.log(
          `[variant-b2-va] pre-request ${atomId} bearer_token_resolved_count(*)=${beforeReads}`,
        );

        const resp = await httpClient.request({ actorId, atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }

        const after = secrets.stats('apify-token');
        const afterReads = after.error !== null ? -1 : after.data.reads;
        console.log(
          `[variant-b2-va] post-request ${atomId} signer_resolved_count(*)=${afterReads}`,
        );

        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            variant: 'b2-va-two-site',
            run: ctx.run_id,
            call_id_seen: resp.data.headers_seen['x-apify-call-id'],
            bearer_seen: resp.data.headers_seen['Authorization'],
          },
          data: {
            jobId:
              resp.data.body && typeof resp.data.body === 'object' && 'runId' in resp.data.body
                ? String((resp.data.body as { runId: unknown }).runId)
                : 'unknown',
            status: resp.data.status,
          },
        });
      }
    },
  });
}

export async function runCellB(): Promise<boolean> {
  console.log('### CELL (b) — B.2 re-resolve + version-aware wrapper, two-site harness ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);
  console.log(statsLine('initial (real)', real.stats('apify-token')));

  const built = await createTwoSiteReResolve({ actorId: 'apify/web-scraper' }, { secrets: wrapped });
  if (built.error !== null) {
    console.log(`[variant-b2-va] cell-b factory ERR ${built.error.code}: ${built.error.message}`);
    return false;
  }
  console.log(statsLine('post-factory (real)', real.stats('apify-token')));

  const ctx: PipelineContext = { run_id: 'run_b2_va_b', signal: new AbortController().signal };
  for await (const result of built.data.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b2-va] cell-b ERR ${result.error.code}: ${result.error.message}`);
      return false;
    }
    console.log(
      `[variant-b2-va] cell-b OK atom ${result.data.id} call_id=${result.data.metadata.call_id_seen as string}`,
    );
  }

  console.log(statsLine('final (real)', real.stats('apify-token')));
  return true;
}

// =============================================================================
// CELL (d) — rotation harness, B.2 re-resolve, version-aware wrapper
// =============================================================================
// The adapter does NOT cache; it calls secrets.resolve on every iter. The
// version-aware wrapper sits at adapter-construction lifetime around the
// real resolver. Mirrors spike-#2 B-CoR shape; replaces the dumb caching
// wrapper with the version-aware one.

function createRotationReResolve(deps: ApifySourceDeps): SourceRotation<ApifyJobItem> {
  const { secrets } = deps;
  return {
    id: 'pk_src_apify_variant_b2_va_rotation',
    async *iter(ctx) {
      const tokenResult = await secrets.resolve('apify-token');
      if (tokenResult.error !== null) {
        yield err(tokenResult.error);
        return;
      }
      const token = tokenResult.data;
      yield ok({
        id: `pk_atom_VARIANT_B2_VA_${ctx.run_id}`,
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: { variant: 'b2-va-rotation', run: ctx.run_id, token_seen: token },
        data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
      });
    },
  };
}

async function emitOnce(
  source: SourceRotation<ApifyJobItem>,
  ctx: PipelineContext,
  label: string,
): Promise<boolean> {
  for await (const result of source.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b2-va] ${label} ERR ${result.error.code}: ${result.error.message}`);
      return false;
    }
    console.log(
      `[variant-b2-va] ${label} OK atom ${result.data.id} token_seen="${result.data.metadata.token_seen as string}"`,
    );
  }
  return true;
}

export async function runCellD(): Promise<boolean> {
  console.log('### CELL (d) — B.2 re-resolve + version-aware wrapper, rotation harness ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);
  // Adapter constructed ONCE, reused across two runs (mirrors spike-#2 B-CoR).
  const apifySource = createRotationReResolve({ secrets: wrapped });

  const ctx1: PipelineContext = { run_id: 'run_1', signal: new AbortController().signal };

  console.log('--- B2-VA rotation: RUN #1 atom 1 (cold cache) ---');
  if (!(await emitOnce(apifySource, ctx1, 'run1.atom1'))) return false;
  console.log(statsLine('run1.atom1 (real)', real.stats('apify-token')));

  console.log('--- B2-VA rotation: RUN #1 atom 2 (warm cache) ---');
  if (!(await emitOnce(apifySource, ctx1, 'run1.atom2'))) return false;
  console.log(statsLine('run1.atom2 (real)', real.stats('apify-token')));

  console.log('--- B2-VA rotation: invalidating apify-token on UNDERLYING real resolver ---');
  const inv = real.invalidate('apify-token');
  if (inv.error !== null) {
    console.log(`[variant-b2-va] invalidate ERR ${inv.error.code}`);
    return false;
  }
  console.log(statsLine('post-invalidate (real)', real.stats('apify-token')));

  console.log('--- B2-VA rotation: RUN #1 atom 3 (post-rotation) ---');
  if (!(await emitOnce(apifySource, ctx1, 'run1.atom3'))) return false;
  console.log(statsLine('run1.atom3 (real)', real.stats('apify-token')));

  const ctx2: PipelineContext = { run_id: 'run_2', signal: new AbortController().signal };
  console.log('--- B2-VA rotation: RUN #2 atom 1 (fresh ctx, REUSED adapter) ---');
  if (!(await emitOnce(apifySource, ctx2, 'run2.atom1'))) return false;
  console.log(statsLine('run2.atom1 (real)', real.stats('apify-token')));
  return true;
}

async function main(): Promise<void> {
  const okB = await runCellB();
  console.log('');
  const okD = await runCellD();
  if (!okB || !okD) {
    process.exitCode = 1;
  }
}

await main();

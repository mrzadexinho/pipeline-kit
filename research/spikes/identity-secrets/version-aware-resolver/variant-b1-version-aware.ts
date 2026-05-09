// Cat VIII spike #4 leg-1 — Variant B.1 (close-over) under version-aware wrapper.
// Two harnesses run in this file:
//
//   CELL (a) two-site / B.1 + version-aware
//     Mirrors spike-#3 B.1 shape: factory resolves bearer ONCE; signer
//     closure captures the same string. Single resolve regardless of atom
//     count. Difference vs spike #3: the resolver handed in via deps is the
//     version-aware wrapper around a fresh real resolver. No rotation event;
//     this cell measures pure read-count behaviour under wrapping.
//
//   CELL (c) rotation / B.1 + version-aware
//     Mirrors spike-#2 B-CoA rotation harness: factory builds, run #1 atom 1
//     cold, atom 2 warm, invalidate, atom 3 post-rotation, then run #2 atom
//     1 with fresh ctx and SAME adapter. Difference vs spike #2: deps.secrets
//     is the version-aware wrapper. The question: does the wrapper close
//     the cross-run staleness leak observed in spike #2 §6 for B-CoA?

import {
  type ApifyHttpClient,
  type ApifyHttpError,
  createApifyHttpClient,
  mintCallId,
} from './mock-apify-http-client.ts';
import {
  createMockSecretsResolver,
  err,
  ok,
  type Result,
  type SecretStats,
  type SecretsError,
  type SecretsResolver,
} from './mock-secrets-resolver.ts';
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

// Variant B: ctx is pure run-scope.
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
  if (s.error !== null) return `[variant-b1-va] ${label} stats ERR ${s.error.code}`;
  return `[variant-b1-va] ${label} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

// =============================================================================
// CELL (a) — two-site harness, B.1 close-over, version-aware wrapper
// =============================================================================

async function createTwoSiteCloseOver(
  args: ApifySourceArgs,
  deps: ApifySourceDeps,
): Promise<Result<SourceTwoSite<ApifyJobResult>, ApifySourceError>> {
  const { actorId } = args;
  const { secrets } = deps;

  // Factory-time site: bearer token resolved ONCE.
  const tokenResult = await secrets.resolve('apify-token');
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  // Both bearer + signer close over tokenAtFactory. Signer never re-resolves.
  const httpClient: ApifyHttpClient = createApifyHttpClient({
    bearerToken: tokenAtFactory,
    signRequest: async (atomId) => ok(mintCallId(tokenAtFactory, atomId)),
  });

  return ok({
    id: 'pk_src_apify_variant_b1_va',
    async *iter(ctx) {
      const atomIds = ['pk_atom_VARIANT_B1_VA_01', 'pk_atom_VARIANT_B1_VA_02'];
      for (const atomId of atomIds) {
        const before = secrets.stats('apify-token');
        const beforeReads = before.error !== null ? -1 : before.data.reads;
        console.log(
          `[variant-b1-va] pre-request ${atomId} bearer_token_resolved_count(*)=${beforeReads}`,
        );

        const resp = await httpClient.request({ actorId, atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }

        const after = secrets.stats('apify-token');
        const afterReads = after.error !== null ? -1 : after.data.reads;
        console.log(
          `[variant-b1-va] post-request ${atomId} signer_resolved_count(*)=${afterReads}`,
        );

        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            variant: 'b1-va-two-site',
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

export async function runCellA(): Promise<boolean> {
  console.log('### CELL (a) — B.1 close-over + version-aware wrapper, two-site harness ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);
  console.log(statsLine('initial (real)', real.stats('apify-token')));

  const built = await createTwoSiteCloseOver(
    { actorId: 'apify/web-scraper' },
    { secrets: wrapped },
  );
  if (built.error !== null) {
    console.log(`[variant-b1-va] cell-a factory ERR ${built.error.code}: ${built.error.message}`);
    return false;
  }
  console.log(statsLine('post-factory (real)', real.stats('apify-token')));

  const ctx: PipelineContext = { run_id: 'run_b1_va_a', signal: new AbortController().signal };
  for await (const result of built.data.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b1-va] cell-a ERR ${result.error.code}: ${result.error.message}`);
      return false;
    }
    console.log(
      `[variant-b1-va] cell-a OK atom ${result.data.id} call_id=${result.data.metadata.call_id_seen as string}`,
    );
  }

  console.log(statsLine('final (real)', real.stats('apify-token')));
  return true;
}

// =============================================================================
// CELL (c) — rotation harness, B.1 close-over, version-aware wrapper
// =============================================================================
// Mirrors spike-#2 B-CoA shape but the adapter receives the wrapped resolver
// instead of the raw real one. The adapter itself does NOT cache (the wrapper
// owns caching) — this is the natural shape for B + version-aware default.

function createRotationCloseOver(deps: ApifySourceDeps): SourceRotation<ApifyJobItem> {
  const { secrets } = deps;
  return {
    id: 'pk_src_apify_variant_b1_va_rotation',
    async *iter(ctx) {
      const tokenResult = await secrets.resolve('apify-token');
      if (tokenResult.error !== null) {
        yield err(tokenResult.error);
        return;
      }
      const token = tokenResult.data;
      yield ok({
        id: `pk_atom_VARIANT_B1_VA_${ctx.run_id}`,
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: { variant: 'b1-va-rotation', run: ctx.run_id, token_seen: token },
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
      console.log(`[variant-b1-va] ${label} ERR ${result.error.code}: ${result.error.message}`);
      return false;
    }
    console.log(
      `[variant-b1-va] ${label} OK atom ${result.data.id} token_seen="${result.data.metadata.token_seen as string}"`,
    );
  }
  return true;
}

export async function runCellC(): Promise<boolean> {
  console.log('### CELL (c) — B.1 close-over + version-aware wrapper, rotation harness ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);
  // Adapter constructed ONCE, reused across two runs (mirrors spike-#2 B-CoA).
  const apifySource = createRotationCloseOver({ secrets: wrapped });

  const ctx1: PipelineContext = { run_id: 'run_1', signal: new AbortController().signal };

  console.log('--- B1-VA rotation: RUN #1 atom 1 (cold cache) ---');
  if (!(await emitOnce(apifySource, ctx1, 'run1.atom1'))) return false;
  console.log(statsLine('run1.atom1 (real)', real.stats('apify-token')));

  console.log('--- B1-VA rotation: RUN #1 atom 2 (warm cache, no rotation) ---');
  if (!(await emitOnce(apifySource, ctx1, 'run1.atom2'))) return false;
  console.log(statsLine('run1.atom2 (real)', real.stats('apify-token')));

  console.log('--- B1-VA rotation: invalidating apify-token on REAL resolver ---');
  const inv = real.invalidate('apify-token');
  if (inv.error !== null) {
    console.log(`[variant-b1-va] invalidate ERR ${inv.error.code}`);
    return false;
  }
  console.log(statsLine('post-invalidate (real)', real.stats('apify-token')));

  console.log('--- B1-VA rotation: RUN #1 atom 3 (post-rotation, same adapter+ctx) ---');
  if (!(await emitOnce(apifySource, ctx1, 'run1.atom3'))) return false;
  console.log(statsLine('run1.atom3 (real)', real.stats('apify-token')));

  // Run #2: fresh ctx, SAME adapter (the spike-#2 leak path).
  const ctx2: PipelineContext = { run_id: 'run_2', signal: new AbortController().signal };
  console.log('--- B1-VA rotation: RUN #2 atom 1 (fresh ctx, REUSED adapter) ---');
  if (!(await emitOnce(apifySource, ctx2, 'run2.atom1'))) return false;
  console.log(statsLine('run2.atom1 (real)', real.stats('apify-token')));
  return true;
}

async function main(): Promise<void> {
  const okA = await runCellA();
  console.log('');
  const okC = await runCellC();
  if (!okA || !okC) {
    process.exitCode = 1;
  }
}

await main();

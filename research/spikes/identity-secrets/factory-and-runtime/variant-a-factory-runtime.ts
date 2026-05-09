// Cat VIII spike #3 — Variant A (factory-and-runtime).
// Shape: ctx.secrets.resolve(...) — the run-scope ambient pattern.
//
// Structural problem: A has no factory-stage signal. createApifySource(args)
// has no ctx at factory time, so the bearer-token resolution that wants to
// happen "once at HTTP-client construction" cannot run there.
//
// Three honest paths exist; the brief asks for A.2 (deferred construction).
// Documenting all three so the trade is on the record:
//
//   A.1 — resolve token inside iter() and re-construct the HTTP client
//         per atom. Forces a resolve + a client construction every iteration;
//         not what real adapters want.
//   A.2 — resolve token inside iter() ONCE on first call; lazily cache on
//         closure; pass to a deferred-construction client that runs from
//         iter() onward. Closest natural A shape — the "factory" runs after
//         ctx is available, so factory-time and run-time observably collapse
//         into "first iter() call".  ← THIS FILE IMPLEMENTS A.2.
//   A.3 — pass ctx.secrets into the request signer closure (run-time). With
//         A.2 the bearer site is also resolved from ctx.secrets, so this
//         file effectively combines A.2 + A.3: the signer closure ALSO pulls
//         from ctx.secrets, making the two read sites visible side-by-side.
//
// Trace lines snapshot reads from secrets.stats('apify-token') before
// (factory-as-first-iter) and after (per-atom signer call) so the read-count
// observable can be compared 1:1 with variant B's read counts.

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

// --- Atom envelope (kit ADR mirror) ---
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

// Variant A: ctx carries secrets.
interface PipelineContext {
  run_id: string;
  secrets: SecretsResolver;
  signal: AbortSignal;
}

// Source error union: secrets errors OR HTTP-client errors can surface.
type ApifySourceError = SecretsError | ApifyHttpError;

interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, ApifySourceError>>;
}

// --- Source factory. NOTE the awkwardness: at factory time we have nothing.
// ctx isn't available yet. So the "factory-time" bearer resolve is deferred
// into iter() (the A.2 shape), and the signer closure ALSO reads from
// ctx.secrets (the A.3 element). Both resolution sites are inside iter().
function createApifySource(args: { actorId: string }): Source<ApifyJobResult> {
  const { actorId } = args;
  // Closure cache for the bearer-token resolved at first iter(). Mirrors the
  // A.2 "lazy factory" intent: one resolve regardless of atom count, until
  // the source is reconstructed.
  let httpClient: ApifyHttpClient | undefined;

  return {
    id: 'pk_src_apify_variant_a_factory_runtime',
    async *iter(ctx) {
      // --- Factory-equivalent site: lazy bearer resolve on first iter(). ---
      if (httpClient === undefined) {
        const bearerResult = await ctx.secrets.resolve('apify-token');
        if (bearerResult.error !== null) {
          yield err(bearerResult.error);
          return;
        }
        // Build the HTTP client with the closed-over bearer (factory time)
        // AND a signer that re-resolves the live token at run time per call.
        httpClient = createApifyHttpClient({
          bearerToken: bearerResult.data,
          signRequest: async (atomId) => {
            // --- Run-time site: re-resolve via ctx.secrets per request. ---
            const live = await ctx.secrets.resolve('apify-token');
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
      }

      // Two atoms emitted to make per-request behaviour observable.
      const atomIds = ['pk_atom_VARIANT_A_01', 'pk_atom_VARIANT_A_02'];
      for (const atomId of atomIds) {
        const before = ctx.secrets.stats('apify-token');
        const beforeReads = before.error !== null ? -1 : before.data.reads;
        console.log(
          `[variant-a] pre-request ${atomId} bearer_token_resolved_count(*)=${beforeReads}`,
        );

        const resp = await httpClient.request({ actorId, atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }

        const after = ctx.secrets.stats('apify-token');
        const afterReads = after.error !== null ? -1 : after.data.reads;
        console.log(
          `[variant-a] post-request ${atomId} signer_resolved_count(*)=${afterReads}`,
        );

        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            variant: 'a-factory-runtime',
            run: ctx.run_id,
            call_id_seen: resp.data.headers_seen['x-apify-call-id'],
            bearer_seen: resp.data.headers_seen['Authorization'],
          },
          data: { jobId: resp.data.body && typeof resp.data.body === 'object' && 'runId' in resp.data.body
            ? String((resp.data.body as { runId: unknown }).runId)
            : 'unknown',
            status: resp.data.status },
        });
      }
    },
  };
}

// (*) The same counter advances on bearer-resolve and signer-resolve since
// both are reads of the same secret name. The point is volume: A.2 cannot
// resolve "only once at factory" because there is no factory; the signer's
// run-time resolve runs N times for N atoms.

function statsLine(label: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[variant-a] ${label} stats ERR ${s.error.code}`;
  return `[variant-a] ${label} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

async function main(): Promise<void> {
  const real = createMockSecretsResolver();
  const ctx: PipelineContext = {
    run_id: 'run_a',
    secrets: real,
    signal: new AbortController().signal,
  };

  console.log('### CELL A — variant A, ctx.secrets, deferred-construction (A.2 + A.3) ###');
  console.log(statsLine('initial (real)', real.stats('apify-token')));

  const source = createApifySource({ actorId: 'apify/web-scraper' });
  for await (const result of source.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-a] ERR ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `[variant-a] OK atom ${result.data.id} job=${result.data.data.jobId} ` +
        `status=${result.data.data.status} call_id=${result.data.metadata.call_id_seen as string}`,
    );
  }

  console.log(statsLine('final (real)', real.stats('apify-token')));
}

await main();

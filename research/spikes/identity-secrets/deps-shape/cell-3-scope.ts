// Cat VIII spike #6 leg-3 — CELL (3): scoped sub-resolver in deps.
// Inherits cell-f shape from spike #5, EXTENDED to N=3 secrets in the
// apify namespace. No Store stage (Source-only at N=3).
//
// The driver constructs the scope at the DI boundary
// (`apifySecrets = wrapped.scope('apify')`) and passes the sub-view to
// the factory. The factory's `deps` is `{ apifySecrets:
// ScopedSecretsResolver }` — type-pinned to the apify namespace at the
// adapter signature.
//
// Reads (all on the parent wrapper via composite-name forwarding):
//   - apifySecrets.resolve('token')          → 'apify-token'           (factory + run-time, 2 sites)
//   - apifySecrets.resolve('actor-id')       → 'apify-actor-id'        (factory only)
//   - apifySecrets.resolve('webhook-secret') → 'apify-webhook-secret'  (factory only)
//
// Shared version-aware wrapper over a fresh real resolver. By
// construction (composite-name + sub-view shares parent cache) the
// runtime ledger is byte-identical to cell (1). Empirical signal is
// purely call-site ergonomics + discoverability + composition tax.

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
} from './mock-secrets-resolver.ts';
import {
  createVersionAwareResolver,
  type ScopedSecretsResolver,
} from './version-aware-resolver.ts';

interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

type ApifySourceError = SecretsError | ApifyHttpError;

interface ApifyAtom {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: { cell: string; run: string; call_id_seen: string };
  data: { jobId: string; status: number };
}

interface ApifySource {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<ApifyAtom, ApifySourceError>>;
}

// Underlying real-resolver names (used by the cell driver for stats
// observation only). The factory itself sees only short suffix names.
const REAL_NAMES = ['apify-token', 'apify-actor-id', 'apify-webhook-secret'] as const;

function statsLine(label: string, name: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[cell-3] ${label} ${name} stats ERR ${s.error.code}`;
  return `[cell-3] ${label} ${name} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

// --- Source(apify) factory — SCOPED sub-resolver in deps ---
async function createApifySource(deps: {
  apifySecrets: ScopedSecretsResolver;
}): Promise<Result<ApifySource, ApifySourceError>> {
  const { apifySecrets } = deps;

  // Three factory-time reads, all on the scoped sub-view. Suffix names
  // are string literals; the deps type pins the namespace.
  const tokenResult = await apifySecrets.resolve('token'); // factory-time site #1 (SCOPED)
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  const actorResult = await apifySecrets.resolve('actor-id'); // factory-time only (SCOPED)
  if (actorResult.error !== null) return err(actorResult.error);
  const actorId = actorResult.data;

  const whsecResult = await apifySecrets.resolve('webhook-secret'); // factory-time only (SCOPED)
  if (whsecResult.error !== null) return err(whsecResult.error);
  const webhookSecret = whsecResult.data;

  const httpClient: ApifyHttpClient = createApifyHttpClient({
    bearerToken: tokenAtFactory,
    actorId,
    webhookSecret,
    signRequest: async (atomId) => {
      const live = await apifySecrets.resolve('token'); // run-time site (SCOPED)
      if (live.error !== null) {
        return err({
          type: 'apify_http_error',
          code: 'signer_failed',
          message: `signer could not resolve apify-token: ${live.error.message}`,
          param: 'token',
        });
      }
      return ok(mintCallId(live.data, atomId));
    },
  });

  return ok({
    id: 'pk_src_apify_cell_3',
    async *iter(ctx) {
      const atomIds = ['pk_atom_CELL_3_01', 'pk_atom_CELL_3_02'];
      for (const atomId of atomIds) {
        const resp = await httpClient.request({ atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }
        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            cell: '3-scope',
            run: ctx.run_id,
            call_id_seen: resp.data.headers_seen['x-apify-call-id']!,
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

// --- Cell driver ---
export async function runCell3(): Promise<boolean> {
  console.log('### CELL (3) — scoped sub-resolver in deps, Source(apify) at N=3 ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);
  // DI-boundary scope construction — factory sees a sub-view, not the parent.
  const apifySecrets = wrapped.scope('apify');

  for (const name of REAL_NAMES) console.log(statsLine('initial (real)', name, real.stats(name)));

  const sourceBuilt = await createApifySource({ apifySecrets });
  if (sourceBuilt.error !== null) {
    const code: string = 'code' in sourceBuilt.error ? sourceBuilt.error.code : 'unknown';
    const msg: string = 'message' in sourceBuilt.error ? sourceBuilt.error.message : '';
    console.log(`[cell-3] source factory ERR ${code}: ${msg}`);
    return false;
  }

  for (const name of REAL_NAMES)
    console.log(statsLine('post-factory (real)', name, real.stats(name)));

  const ctx: PipelineContext = { run_id: 'run_cell_3', signal: new AbortController().signal };

  let i = 0;
  for await (const result of sourceBuilt.data.iter(ctx)) {
    i += 1;
    if (result.error !== null) {
      const code: string = 'code' in result.error ? result.error.code : 'unknown';
      const msg: string = 'message' in result.error ? result.error.message : '';
      console.log(`[cell-3] atom ${i} source ERR ${code}: ${msg}`);
      return false;
    }
    const atom = result.data;
    console.log(`[cell-3] atom ${i} source OK id=${atom.id} call_id=${atom.metadata.call_id_seen}`);
    for (const name of REAL_NAMES)
      console.log(statsLine(`after-atom-${i} (real)`, name, real.stats(name)));
  }

  for (const name of REAL_NAMES) console.log(statsLine('final (real)', name, real.stats(name)));
  return true;
}

async function main(): Promise<void> {
  const okRun = await runCell3();
  if (!okRun) process.exitCode = 1;
}

await main();

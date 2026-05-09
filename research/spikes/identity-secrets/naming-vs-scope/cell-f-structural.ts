// Cat VIII spike #5 leg-2 sub-(1) — CELL (f): structural scope.
// Source: scope('apify').resolve('token'); Store: scope('supabase').resolve('service-role').
// Shared version-aware wrapper over a shared real resolver. Source is
// two-site (factory + per-request signer); Store is single-site at factory.
// Read counts logged at initial / post-factory / after each atom / final.
// Cells (e) and (f) hit the SAME cache entries by construction — scope() is a
// pure name-composition façade (composite name = `${prefix}-${suffix}` via
// hyphen joiner). Empirical signal is purely ergonomics + tax.

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
  createMockSupabaseStore,
  type StoreContext,
  type SupabaseAtom,
  type SupabaseStore,
} from './mock-supabase-store.ts';
import {
  createVersionAwareResolver,
  type ScopedSecretsResolver,
} from './version-aware-resolver.ts';

interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

type ApifySourceError = SecretsError | ApifyHttpError;

interface ApifySource {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<SupabaseAtom, ApifySourceError>>;
}

function statsLine(label: string, name: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[cell-f] ${label} ${name} stats ERR ${s.error.code}`;
  return `[cell-f] ${label} ${name} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

// --- Source(apify) factory — STRUCTURAL scope ---
async function createApifySource(
  args: { actorId: string },
  deps: { secrets: ScopedSecretsResolver },
): Promise<Result<ApifySource, ApifySourceError>> {
  const { actorId } = args;
  const apifySecrets = deps.secrets.scope('apify'); // sub-view (cache shared with parent)

  const tokenResult = await apifySecrets.resolve('token'); // factory-time site (SCOPED)
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  const httpClient: ApifyHttpClient = createApifyHttpClient({
    bearerToken: tokenAtFactory,
    signRequest: async (atomId) => {
      const live = await apifySecrets.resolve('token'); // run-time site (SCOPED)
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
    id: 'pk_src_apify_cell_f',
    async *iter(ctx) {
      const atomIds = ['pk_atom_CELL_F_01', 'pk_atom_CELL_F_02'];
      for (const atomId of atomIds) {
        const resp = await httpClient.request({ actorId, atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }
        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            cell: 'f-structural',
            run: ctx.run_id,
            call_id_seen: resp.data.headers_seen['x-apify-call-id'],
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

// --- Store(supabase) factory — STRUCTURAL scope ---
async function createSupabaseStore(deps: {
  secrets: ScopedSecretsResolver;
}): Promise<Result<SupabaseStore, SecretsError>> {
  const supabaseSecrets = deps.secrets.scope('supabase');
  const keyResult = await supabaseSecrets.resolve('service-role'); // factory-time (SCOPED)
  if (keyResult.error !== null) return err(keyResult.error);
  return ok(createMockSupabaseStore({ serviceRoleKey: keyResult.data }));
}

// --- Cell driver ---
export async function runCellF(): Promise<boolean> {
  console.log('### CELL (f) — structural scope, two-stage two-secret pipeline ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);

  console.log(statsLine('initial (real)', 'apify-token', real.stats('apify-token')));
  console.log(
    statsLine('initial (real)', 'supabase-service-role', real.stats('supabase-service-role')),
  );

  const sourceBuilt = await createApifySource(
    { actorId: 'apify/web-scraper' },
    { secrets: wrapped },
  );
  if (sourceBuilt.error !== null) {
    console.log(
      `[cell-f] source factory ERR ${sourceBuilt.error.code}: ${sourceBuilt.error.message}`,
    );
    return false;
  }
  const storeBuilt = await createSupabaseStore({ secrets: wrapped });
  if (storeBuilt.error !== null) {
    console.log(`[cell-f] store factory ERR ${storeBuilt.error.code}: ${storeBuilt.error.message}`);
    return false;
  }

  console.log(statsLine('post-factory (real)', 'apify-token', real.stats('apify-token')));
  console.log(
    statsLine('post-factory (real)', 'supabase-service-role', real.stats('supabase-service-role')),
  );

  const ctx: PipelineContext = { run_id: 'run_cell_f', signal: new AbortController().signal };
  const storeCtx: StoreContext = { run_id: ctx.run_id, signal: ctx.signal };

  let i = 0;
  for await (const result of sourceBuilt.data.iter(ctx)) {
    i += 1;
    if (result.error !== null) {
      const code: string = 'code' in result.error ? result.error.code : 'unknown';
      const msg: string = 'message' in result.error ? result.error.message : '';
      console.log(`[cell-f] atom ${i} source ERR ${code}: ${msg}`);
      return false;
    }
    const atom = result.data;
    console.log(
      `[cell-f] atom ${i} source OK id=${atom.id} call_id=${atom.metadata.call_id_seen as string}`,
    );
    const put = await storeBuilt.data.put(atom, storeCtx);
    if (put.error !== null) {
      console.log(`[cell-f] atom ${i} store ERR ${put.error.code}: ${put.error.message}`);
      return false;
    }
    console.log(statsLine(`after-atom-${i} (real)`, 'apify-token', real.stats('apify-token')));
    console.log(
      statsLine(
        `after-atom-${i} (real)`,
        'supabase-service-role',
        real.stats('supabase-service-role'),
      ),
    );
  }

  console.log(statsLine('final (real)', 'apify-token', real.stats('apify-token')));
  console.log(
    statsLine('final (real)', 'supabase-service-role', real.stats('supabase-service-role')),
  );
  return true;
}

async function main(): Promise<void> {
  const okRun = await runCellF();
  if (!okRun) process.exitCode = 1;
}

await main();

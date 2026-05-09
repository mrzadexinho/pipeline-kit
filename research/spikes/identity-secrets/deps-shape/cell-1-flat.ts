// Cat VIII spike #6 leg-3 — CELL (1): flat / single resolver, multi-resolve.
// Inherits cell-e shape from spike #5, EXTENDED to N=3 secrets in the
// apify namespace. No Store stage (Source-only at N=3).
//
// Reads (all on the parent wrapper, all in the apify namespace):
//   - secrets.resolve('apify-token')         — factory + run-time signer (2 sites)
//   - secrets.resolve('apify-actor-id')      — factory only
//   - secrets.resolve('apify-webhook-secret')— factory only
//
// Shared version-aware wrapper over a fresh real resolver. Read counts
// logged at initial / post-factory / after each atom / final for all 3
// names. Cells (1) and (3) hit the same parent cache by construction
// (scope() is a name-composition façade); empirical signal is purely
// call-site ergonomics + discoverability + composition tax + import count.

import {
  type SecretsError,
  type SecretsResolver,
  type SecretStats,
  type Result,
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

interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

type ApifySourceError = SecretsError | ApifyHttpError;

// Source emits a minimal atom envelope (kit-shape: id / object /
// created_at / metadata + payload). No Store stage, so the cell driver
// just consumes the atoms inline.
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

const NAMES = ['apify-token', 'apify-actor-id', 'apify-webhook-secret'] as const;

function statsLine(label: string, name: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[cell-1] ${label} ${name} stats ERR ${s.error.code}`;
  return `[cell-1] ${label} ${name} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

// --- Source(apify) factory — FLAT / single resolver, multi-resolve ---
async function createApifySource(
  deps: { secrets: SecretsResolver },
): Promise<Result<ApifySource, ApifySourceError>> {
  const { secrets } = deps;

  // Three factory-time reads, all on the same flat resolver. Names are
  // string literals; the resolver's type does NOT pin the namespace.
  const tokenResult = await secrets.resolve('apify-token'); // factory-time site #1 (FLAT)
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  const actorResult = await secrets.resolve('apify-actor-id'); // factory-time only (FLAT)
  if (actorResult.error !== null) return err(actorResult.error);
  const actorId = actorResult.data;

  const whsecResult = await secrets.resolve('apify-webhook-secret'); // factory-time only (FLAT)
  if (whsecResult.error !== null) return err(whsecResult.error);
  const webhookSecret = whsecResult.data;

  const httpClient: ApifyHttpClient = createApifyHttpClient({
    bearerToken: tokenAtFactory,
    actorId,
    webhookSecret,
    signRequest: async (atomId) => {
      const live = await secrets.resolve('apify-token'); // run-time site (FLAT)
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
    id: 'pk_src_apify_cell_1',
    async *iter(ctx) {
      const atomIds = ['pk_atom_CELL_1_01', 'pk_atom_CELL_1_02'];
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
            cell: '1-flat',
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
export async function runCell1(): Promise<boolean> {
  console.log('### CELL (1) — flat / single resolver, multi-resolve, Source(apify) at N=3 ###');
  const real = createMockSecretsResolver();
  const wrapped = createVersionAwareResolver(real);

  for (const name of NAMES) console.log(statsLine('initial (real)', name, real.stats(name)));

  const sourceBuilt = await createApifySource({ secrets: wrapped });
  if (sourceBuilt.error !== null) {
    const code: string = 'code' in sourceBuilt.error ? sourceBuilt.error.code : 'unknown';
    const msg: string = 'message' in sourceBuilt.error ? sourceBuilt.error.message : '';
    console.log(`[cell-1] source factory ERR ${code}: ${msg}`);
    return false;
  }

  for (const name of NAMES) console.log(statsLine('post-factory (real)', name, real.stats(name)));

  const ctx: PipelineContext = { run_id: 'run_cell_1', signal: new AbortController().signal };

  let i = 0;
  for await (const result of sourceBuilt.data.iter(ctx)) {
    i += 1;
    if (result.error !== null) {
      const code: string = 'code' in result.error ? result.error.code : 'unknown';
      const msg: string = 'message' in result.error ? result.error.message : '';
      console.log(`[cell-1] atom ${i} source ERR ${code}: ${msg}`);
      return false;
    }
    const atom = result.data;
    console.log(`[cell-1] atom ${i} source OK id=${atom.id} call_id=${atom.metadata.call_id_seen}`);
    for (const name of NAMES) console.log(statsLine(`after-atom-${i} (real)`, name, real.stats(name)));
  }

  for (const name of NAMES) console.log(statsLine('final (real)', name, real.stats(name)));
  return true;
}

async function main(): Promise<void> {
  const okRun = await runCell1();
  if (!okRun) process.exitCode = 1;
}

await main();

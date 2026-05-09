// Cat VIII spike #3 — Variant B (factory-and-runtime).
// Shape: createApifySource({ deps: { secrets } }) — adapter dependency.
// Factory CAN resolve at construction time because deps.secrets is in scope.
//
// Two sub-cells in this file, run in sequence against fresh resolver
// instances (mirrors spike-#2 sub-case pattern, keeping read counters honest):
//
//   B.1 close-over:
//     Factory resolves the bearer ONCE; the signer closure also captures
//     that same string from the factory call. Single resolve regardless of
//     atom count. STALE on rotation (out of scope here — see spike #2 §6).
//
//   B.2 re-resolve at run-time:
//     Factory resolves the bearer ONCE for HTTP-client construction.
//     Signer closure re-resolves on every call via deps.secrets. Two
//     resolution sites, two reads visible per atom.
//
// Both sub-cells emit two atoms each. After each atom the harness prints a
// reads snapshot from secrets.stats('apify-token') so:
//   - B.1 shows reads=1 throughout
//   - B.2 shows reads=N+1 (one factory-time + one per atom)

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

// Variant B: ctx no longer carries secrets — pure run-scope.
interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

// Source error union for B.
type ApifySourceError = SecretsError | ApifyHttpError;

interface ApifySourceDeps {
  secrets: SecretsResolver;
}

interface ApifySourceArgs {
  actorId: string;
}

interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, ApifySourceError>>;
}

// =============================================================================
// SUB-CELL B.1 — close-over (single resolve, both sites use the captured token)
// =============================================================================

async function createApifySourceCloseOver(
  args: ApifySourceArgs,
  deps: ApifySourceDeps,
): Promise<Result<Source<ApifyJobResult>, ApifySourceError>> {
  const { actorId } = args;
  const { secrets } = deps;

  // --- Factory-time site: bearer token resolved ONCE at construction.
  const tokenResult = await secrets.resolve('apify-token');
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  // HTTP client closes over tokenAtFactory both for bearer AND for signer.
  // Signer does NOT re-resolve — it captures the same value.
  const httpClient: ApifyHttpClient = createApifyHttpClient({
    bearerToken: tokenAtFactory,
    signRequest: async (atomId) => ok(mintCallId(tokenAtFactory, atomId)),
  });

  return ok({
    id: 'pk_src_apify_variant_b_close_over',
    async *iter(ctx) {
      const atomIds = [`pk_atom_VARIANT_B_B1_01`, `pk_atom_VARIANT_B_B1_02`];
      for (const atomId of atomIds) {
        const resp = await httpClient.request({ actorId, atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }
        const after = secrets.stats('apify-token');
        const afterReads = after.error !== null ? -1 : after.data.reads;
        console.log(`[variant-b] B.1 post-request ${atomId} reads=${afterReads}`);
        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            variant: 'b-close-over',
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

// =============================================================================
// SUB-CELL B.2 — re-resolve at run-time (factory resolves bearer; signer
// re-resolves per call via deps.secrets — two sites, two reads per atom)
// =============================================================================

async function createApifySourceReResolve(
  args: ApifySourceArgs,
  deps: ApifySourceDeps,
): Promise<Result<Source<ApifyJobResult>, ApifySourceError>> {
  const { actorId } = args;
  const { secrets } = deps;

  // --- Factory-time site: bearer token resolved ONCE for HTTP-client ctor.
  const tokenResult = await secrets.resolve('apify-token');
  if (tokenResult.error !== null) return err(tokenResult.error);
  const tokenAtFactory = tokenResult.data;

  // HTTP client: bearer is closed-over from factory; signer re-resolves
  // on every call via deps.secrets — the run-time site.
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
    id: 'pk_src_apify_variant_b_re_resolve',
    async *iter(ctx) {
      const atomIds = [`pk_atom_VARIANT_B_B2_01`, `pk_atom_VARIANT_B_B2_02`];
      for (const atomId of atomIds) {
        const resp = await httpClient.request({ actorId, atomId });
        if (resp.error !== null) {
          yield err(resp.error);
          return;
        }
        const after = secrets.stats('apify-token');
        const afterReads = after.error !== null ? -1 : after.data.reads;
        console.log(`[variant-b] B.2 post-request ${atomId} reads=${afterReads}`);
        yield ok({
          id: atomId,
          object: 'atom',
          created_at: new Date().toISOString(),
          metadata: {
            variant: 'b-re-resolve',
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

function statsLine(label: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[variant-b] ${label} stats ERR ${s.error.code}`;
  return `[variant-b] ${label} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

async function runB1(): Promise<boolean> {
  console.log('### CELL B.1 — variant B, close-over (factory-only resolve, both sites) ###');
  const real = createMockSecretsResolver();
  console.log(statsLine('initial (real)', real.stats('apify-token')));

  const built = await createApifySourceCloseOver({ actorId: 'apify/web-scraper' }, { secrets: real });
  if (built.error !== null) {
    console.log(`[variant-b] B.1 factory ERR ${built.error.code}: ${built.error.message}`);
    return false;
  }
  console.log(statsLine('post-factory (real)', real.stats('apify-token')));

  const ctx: PipelineContext = { run_id: 'run_b1', signal: new AbortController().signal };
  for await (const result of built.data.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b] B.1 ERR ${result.error.code}: ${result.error.message}`);
      return false;
    }
    console.log(
      `[variant-b] B.1 OK atom ${result.data.id} call_id=${result.data.metadata.call_id_seen as string}`,
    );
  }

  console.log(statsLine('final (real)', real.stats('apify-token')));
  return true;
}

async function runB2(): Promise<boolean> {
  console.log('### CELL B.2 — variant B, re-resolve at run-time (factory + per-atom) ###');
  const real = createMockSecretsResolver();
  console.log(statsLine('initial (real)', real.stats('apify-token')));

  const built = await createApifySourceReResolve({ actorId: 'apify/web-scraper' }, { secrets: real });
  if (built.error !== null) {
    console.log(`[variant-b] B.2 factory ERR ${built.error.code}: ${built.error.message}`);
    return false;
  }
  console.log(statsLine('post-factory (real)', real.stats('apify-token')));

  const ctx: PipelineContext = { run_id: 'run_b2', signal: new AbortController().signal };
  for await (const result of built.data.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b] B.2 ERR ${result.error.code}: ${result.error.message}`);
      return false;
    }
    console.log(
      `[variant-b] B.2 OK atom ${result.data.id} call_id=${result.data.metadata.call_id_seen as string}`,
    );
  }

  console.log(statsLine('final (real)', real.stats('apify-token')));
  return true;
}

async function main(): Promise<void> {
  const ok1 = await runB1();
  console.log('');
  const ok2 = await runB2();
  if (!ok1 || !ok2) {
    process.exitCode = 1;
  }
}

await main();

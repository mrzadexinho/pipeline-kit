// Cat VIII spike #2 — Variant B (rotation harness).
// Shape: createApifySource({ deps: { secrets } }); ctx is pure run-scope.
// FINDINGS-1 §4 says "the cache lives on the resolver instance handed in via
// `deps`" under variant B — but that statement bundles two distinct natural
// shapes. To probe both honestly we run TWO sub-cases in one file:
//
//   Sub-case (1) cache-on-adapter:  the adapter caches the resolved token
//   in a closure variable; the resolver itself is uncached. This is the
//   shape you get if the kit author thinks "I'll just remember the token
//   inside the adapter — saves resolver round-trips".
//
//   Sub-case (2) cache-on-resolver: the adapter does not cache; a caching
//   wrapper is constructed once around the real resolver at adapter-
//   construction time, and lives at adapter-construction lifetime. The
//   adapter is reused across two runs.
//
// Both sub-cases are run end-to-end. The harness prints reads + version
// after every observable step so the FINDINGS author can read the
// staleness window directly off the run output.

import {
  type Result,
  type SecretsError,
  type SecretsResolver,
  type SecretStats,
  createMockSecretsResolver,
  err,
  ok,
} from './mock-secrets-resolver.ts';

// --- Shared kit primitives (kept identical to variant A for honest diffing). ---
interface Atom<T> {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
}

interface ApifyJobItem {
  id: string;
  title: string;
  company: string;
}

// Variant B: ctx no longer carries secrets — pure run-scope.
interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

interface ApifySourceDeps {
  secrets: SecretsResolver;
}
interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, SecretsError>>;
}

function statsLine(label: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[variant-b] ${label} stats ERR ${s.error.code}`;
  return `[variant-b] ${label} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

async function emitOnce(source: Source<ApifyJobItem>, ctx: PipelineContext, label: string): Promise<void> {
  for await (const result of source.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b] ${label} ERR ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `[variant-b] ${label} OK atom ${result.data.id} token_seen="${result.data.metadata.token_seen as string}"`,
    );
  }
}

// =============================================================================
// SUB-CASE 1 — cache-on-adapter
// =============================================================================
// The adapter holds a `cachedToken` closure variable. First iter() resolves;
// subsequent iter()s serve the closure-cached token. The adapter exposes no
// invalidate/refresh API — that's the natural day-1 shape if you write it
// without thinking about rotation.

function createApifySourceCacheOnAdapter(deps: ApifySourceDeps): Source<ApifyJobItem> {
  const { secrets } = deps;
  let cachedToken: string | undefined;
  return {
    id: 'pk_src_apify_variant_b_cache_on_adapter',
    async *iter(ctx) {
      if (cachedToken === undefined) {
        const tokenResult = await secrets.resolve('apify-token');
        if (tokenResult.error !== null) {
          yield err(tokenResult.error);
          return;
        }
        cachedToken = tokenResult.data;
      }
      yield ok({
        id: `pk_atom_VARIANT_B_CoA_${ctx.run_id}`,
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: { variant: 'b-cache-on-adapter', run: ctx.run_id, token_seen: cachedToken },
        data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
      });
    },
  };
}

async function mainBcacheOnAdapter(): Promise<void> {
  console.log('### SUB-CASE 1 — variant B, cache-on-adapter ###');
  const real = createMockSecretsResolver();
  // Adapter constructed ONCE, reused across two runs (a real server pattern).
  const apifySource = createApifySourceCacheOnAdapter({ secrets: real });

  const ctx1: PipelineContext = { run_id: 'run_1', signal: new AbortController().signal };

  console.log('--- B-CoA: RUN #1 atom 1 (cold cache) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom1');
  console.log(statsLine('run1.atom1 (real)', real.stats('apify-token')));

  console.log('--- B-CoA: RUN #1 atom 2 (warm cache, no rotation) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom2');
  console.log(statsLine('run1.atom2 (real)', real.stats('apify-token')));

  console.log('--- B-CoA: invalidating apify-token on REAL resolver ---');
  const inv = real.invalidate('apify-token');
  if (inv.error !== null) {
    console.log(`[variant-b] invalidate ERR ${inv.error.code}`);
    process.exitCode = 1;
    return;
  }
  console.log(statsLine('post-invalidate (real)', real.stats('apify-token')));

  console.log('--- B-CoA: RUN #1 atom 3 (post-rotation, same adapter+ctx → expect STALE) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom3');
  console.log(statsLine('run1.atom3 (real)', real.stats('apify-token')));

  // Run #2: fresh ctx, SAME adapter (the leak path).
  const ctx2: PipelineContext = { run_id: 'run_2', signal: new AbortController().signal };
  console.log('--- B-CoA: RUN #2 atom 1 (fresh ctx, REUSED adapter → expect STALE LEAK) ---');
  await emitOnce(apifySource, ctx2, 'run2.atom1');
  console.log(statsLine('run2.atom1 (real)', real.stats('apify-token')));
}

// =============================================================================
// SUB-CASE 2 — cache-on-resolver
// =============================================================================
// The adapter does not cache. A caching wrapper is constructed around the
// real resolver at adapter-construction time and lives at adapter lifetime.
// FINDINGS-1 §4 names this as the "natural variant-B" shape.

function createCachingResolver(real: SecretsResolver): SecretsResolver {
  const cache = new Map<string, string>();
  return {
    async resolve(name) {
      const cached = cache.get(name);
      if (cached !== undefined) return ok(cached);
      const fresh = await real.resolve(name);
      if (fresh.error !== null) return fresh;
      cache.set(name, fresh.data);
      return fresh;
    },
    invalidate(name) {
      // Pass-through. Wrapper's own cache is NOT cleared — same asymmetry
      // as variant A's run-scope cache. Honest evidence of "wrapper is
      // blind to underlying rotation unless told".
      return real.invalidate(name);
    },
    stats(name) {
      return real.stats(name);
    },
  };
}

function createApifySourceNoCache(deps: ApifySourceDeps): Source<ApifyJobItem> {
  const { secrets } = deps;
  return {
    id: 'pk_src_apify_variant_b_cache_on_resolver',
    async *iter(ctx) {
      const tokenResult = await secrets.resolve('apify-token');
      if (tokenResult.error !== null) {
        yield err(tokenResult.error);
        return;
      }
      const token = tokenResult.data;
      yield ok({
        id: `pk_atom_VARIANT_B_CoR_${ctx.run_id}`,
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: { variant: 'b-cache-on-resolver', run: ctx.run_id, token_seen: token },
        data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
      });
    },
  };
}

async function mainBcacheOnResolver(): Promise<void> {
  console.log('### SUB-CASE 2 — variant B, cache-on-resolver ###');
  const real = createMockSecretsResolver();
  // Caching wrapper sits at adapter-construction lifetime.
  const cachingResolver = createCachingResolver(real);
  const apifySource = createApifySourceNoCache({ secrets: cachingResolver });

  const ctx1: PipelineContext = { run_id: 'run_1', signal: new AbortController().signal };

  console.log('--- B-CoR: RUN #1 atom 1 (cold cache) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom1');
  console.log(statsLine('run1.atom1 (real)', real.stats('apify-token')));

  console.log('--- B-CoR: RUN #1 atom 2 (warm cache) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom2');
  console.log(statsLine('run1.atom2 (real)', real.stats('apify-token')));

  console.log('--- B-CoR: invalidating apify-token on UNDERLYING real resolver ---');
  const inv = real.invalidate('apify-token');
  if (inv.error !== null) {
    console.log(`[variant-b] invalidate ERR ${inv.error.code}`);
    process.exitCode = 1;
    return;
  }
  console.log(statsLine('post-invalidate (real)', real.stats('apify-token')));

  console.log('--- B-CoR: RUN #1 atom 3 (post-rotation → expect STALE on caching wrapper) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom3');
  console.log(statsLine('run1.atom3 (real)', real.stats('apify-token')));

  // Run #2 — fresh ctx, SAME adapter (and so SAME caching wrapper).
  const ctx2: PipelineContext = { run_id: 'run_2', signal: new AbortController().signal };
  console.log('--- B-CoR: RUN #2 atom 1 (fresh ctx, REUSED adapter+wrapper → expect STALE LEAK) ---');
  await emitOnce(apifySource, ctx2, 'run2.atom1');
  console.log(statsLine('run2.atom1 (real)', real.stats('apify-token')));
}

async function main(): Promise<void> {
  await mainBcacheOnAdapter();
  console.log('');
  await mainBcacheOnResolver();
}

await main();

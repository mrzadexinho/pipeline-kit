// Cat VIII spike #2 — Variant A (rotation harness).
// Shape: ctx.secrets.resolve(name) inside Source.iter(); secrets ride ctx.
// Cache lives at run scope: a tiny wrapper around the real resolver, attached
// to ctx.secrets. First resolve fetches, subsequent resolves serve cached.
// (Per FINDINGS-1 §4: under variant A "a cache, if added, has to live on
// `ctx.secrets` itself — i.e. the resolver caches at the run scope".)

import {
  createMockSecretsResolver,
  err,
  ok,
  type Result,
  type SecretStats,
  type SecretsError,
  type SecretsResolver,
} from './mock-secrets-resolver.ts';

// --- Atom envelope (kit ADR mirror) ---
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

interface PipelineContext {
  run_id: string;
  secrets: SecretsResolver;
  signal: AbortSignal;
}

interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, SecretsError>>;
}

// --- Run-scope cache wrapper. Constructed per-run; lifetime = ctx lifetime.
// Shape: same SecretsResolver interface, but resolve() is memoized. invalidate
// and stats pass through to the underlying real resolver — the wrapper is
// transparent for those calls (matches the natural variant-A shape: cache is
// "free" on the read path; admin calls go through).
function createRunScopeCache(real: SecretsResolver): SecretsResolver {
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
      // Pass-through to underlying. (Cache wrapper does NOT clear its own
      // cache here — that asymmetry is itself part of the evidence: under
      // variant A, "invalidate" called on ctx.secrets bumps the upstream
      // version but the run still serves stale until ctx is replaced. This
      // is the run-scope cache property in its honest form.)
      return real.invalidate(name);
    },
    stats(name) {
      return real.stats(name);
    },
  };
}

const apifySource: Source<ApifyJobItem> = {
  id: 'pk_src_apify_variant_a',
  async *iter(ctx) {
    const tokenResult = await ctx.secrets.resolve('apify-token');
    if (tokenResult.error !== null) {
      yield err(tokenResult.error);
      return;
    }
    const token = tokenResult.data;
    yield ok({
      id: `pk_atom_VARIANT_A_${ctx.run_id}`,
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: { variant: 'a-rotation', run: ctx.run_id, token_seen: token },
      data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
    });
  },
};

function statsLine(label: string, s: Result<SecretStats, SecretsError>): string {
  if (s.error !== null) return `[variant-a] ${label} stats ERR ${s.error.code}`;
  return `[variant-a] ${label} reads=${s.data.reads} current_version=v${s.data.current_version}`;
}

async function emitOnce(
  source: Source<ApifyJobItem>,
  ctx: PipelineContext,
  label: string,
): Promise<void> {
  for await (const result of source.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-a] ${label} ERR ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `[variant-a] ${label} OK atom ${result.data.id} token_seen="${result.data.metadata.token_seen as string}"`,
    );
  }
}

async function main(): Promise<void> {
  // Single underlying resolver, shared across two simulated runs. (A real
  // process would construct this once at boot.)
  const real = createMockSecretsResolver();

  // --- RUN #1 ---
  // ctx.secrets is the run-scope cache wrapper around real.
  const ctx1: PipelineContext = {
    run_id: 'run_1',
    secrets: createRunScopeCache(real),
    signal: new AbortController().signal,
  };

  console.log('--- variant-a: RUN #1 atom 1 (cold cache) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom1');
  console.log(statsLine('run1.atom1 (real)', real.stats('apify-token')));

  console.log('--- variant-a: RUN #1 atom 2 (warm cache, no rotation yet) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom2');
  console.log(statsLine('run1.atom2 (real)', real.stats('apify-token')));

  // --- ROTATE underlying secret mid-run ---
  console.log('--- variant-a: invalidating apify-token on REAL resolver ---');
  const inv = real.invalidate('apify-token');
  if (inv.error !== null) {
    console.log(`[variant-a] invalidate ERR ${inv.error.code}`);
    process.exitCode = 1;
    return;
  }
  console.log(statsLine('post-invalidate (real)', real.stats('apify-token')));

  console.log('--- variant-a: RUN #1 atom 3 (post-rotation, same ctx → expect STALE) ---');
  await emitOnce(apifySource, ctx1, 'run1.atom3');
  console.log(statsLine('run1.atom3 (real)', real.stats('apify-token')));

  // --- RUN #2 — fresh ctx, same underlying real resolver ---
  const ctx2: PipelineContext = {
    run_id: 'run_2',
    secrets: createRunScopeCache(real),
    signal: new AbortController().signal,
  };

  console.log('--- variant-a: RUN #2 atom 1 (fresh ctx → expect ROTATED value) ---');
  await emitOnce(apifySource, ctx2, 'run2.atom1');
  console.log(statsLine('run2.atom1 (real)', real.stats('apify-token')));
}

await main();

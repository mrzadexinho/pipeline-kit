// Cat VIII spike #1 — Variant A: SecretsAdapter as Context concern.
// Shape: ctx.secrets.resolve('apify-token') inside Source.iter().
// Secrets ride the run-scoped PipelineContext; Source is unaware at construction.

import {
  err,
  mockSecretsResolver,
  ok,
  type Result,
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

// --- Apify-shaped payload (synthetic) ---
interface ApifyJobItem {
  id: string;
  title: string;
  company: string;
}

// --- PipelineContext shim — secrets is a first-class concern. ---
interface PipelineContext {
  run_id: string;
  secrets: SecretsResolver;
  signal: AbortSignal;
}

// --- Source shape: iter(ctx) is an async generator of Result<Atom<O>, Error> ---
interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, SecretsError>>;
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
    // Simulated HTTP call — no real network.
    console.log(`[variant-a] would call apify with Authorization: Bearer ${token}`);
    yield ok({
      id: 'pk_atom_VARIANT_A_01',
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: { variant: 'a-context-concern' },
      data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
    });
  },
};

async function main(): Promise<void> {
  const ctx: PipelineContext = {
    run_id: 'pk_run_VARIANT_A_DEMO',
    secrets: mockSecretsResolver,
    signal: new AbortController().signal,
  };
  for await (const result of apifySource.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-a] ERR ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[variant-a] OK atom ${result.data.id} title="${result.data.data.title}"`);
  }
}

await main();

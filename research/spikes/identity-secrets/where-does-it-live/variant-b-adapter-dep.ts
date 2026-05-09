// Cat VIII spike #1 — Variant B: SecretsAdapter as adapter dependency.
// Shape: Source.create({ deps: { secrets } }).
// Secrets injected at construction; no ctx coupling. Source carries the resolver.

import {
  type Result,
  type SecretsError,
  type SecretsResolver,
  err,
  mockSecretsResolver,
  ok,
} from './mock-secrets-resolver.ts';

// --- Atom envelope ---
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

// --- Context no longer carries secrets — pure run-scoped infra. ---
interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

// --- Source shape: deps captured at construction; iter takes ctx for run-scope only. ---
interface ApifySourceDeps {
  secrets: SecretsResolver;
}
interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, SecretsError>>;
}

function createApifySource(deps: ApifySourceDeps): Source<ApifyJobItem> {
  const { secrets } = deps;
  return {
    id: 'pk_src_apify_variant_b',
    async *iter(_ctx) {
      const tokenResult = await secrets.resolve('apify-token');
      if (tokenResult.error !== null) {
        yield err(tokenResult.error);
        return;
      }
      const token = tokenResult.data;
      console.log(`[variant-b] would call apify with Authorization: Bearer ${token}`);
      yield ok({
        id: 'pk_atom_VARIANT_B_01',
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: { variant: 'b-adapter-dep' },
        data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
      });
    },
  };
}

async function main(): Promise<void> {
  const apifySource = createApifySource({ secrets: mockSecretsResolver });
  const ctx: PipelineContext = {
    run_id: 'pk_run_VARIANT_B_DEMO',
    signal: new AbortController().signal,
  };
  for await (const result of apifySource.iter(ctx)) {
    if (result.error !== null) {
      console.log(`[variant-b] ERR ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[variant-b] OK atom ${result.data.id} title="${result.data.data.title}"`);
  }
}

await main();

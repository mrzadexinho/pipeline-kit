// Cat VIII spike #1 — Variant C: SecretsAdapter as a typed stage.
// Shape: Secrets.fetch('apify-token').through(apifySource).
// Secret resolution is its own pre-stage; Source takes the resolved secret as INPUT.

import {
  type Result,
  type SecretsError,
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

// --- Process<I, O>: takes input, produces async iterable of Atom<O> Results. ---
interface Process<I, O, E> {
  run(input: I): AsyncGenerator<Result<Atom<O>, E>>;
}

// --- Secrets stage type — Secrets.fetch(name) returns a typed stage that pipes
//     a resolved secret string into a downstream Process<string, O, E | SecretsError>. ---
interface SecretsStage {
  through<O, E>(
    next: Process<string, O, E>,
  ): {
    run(): AsyncGenerator<Result<Atom<O>, E | SecretsError>>;
  };
}

const Secrets = {
  fetch(name: string): SecretsStage {
    return {
      through<O, E>(next: Process<string, O, E>) {
        return {
          async *run(): AsyncGenerator<Result<Atom<O>, E | SecretsError>> {
            const r = await mockSecretsResolver.resolve(name);
            if (r.error !== null) {
              yield err(r.error);
              return;
            }
            for await (const atom of next.run(r.data)) yield atom;
          },
        };
      },
    };
  },
};

// --- apifySource here is a Process<string, ApifyJobItem, never>: takes the secret as input. ---
const apifySource: Process<string, ApifyJobItem, never> = {
  async *run(token) {
    console.log(`[variant-c] would call apify with Authorization: Bearer ${token}`);
    yield ok({
      id: 'pk_atom_VARIANT_C_01',
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: { variant: 'c-stage-type' },
      data: { id: 'apify_job_1', title: 'Senior Backend Engineer', company: 'Acme' },
    });
  },
};

async function main(): Promise<void> {
  const pipeline = Secrets.fetch('apify-token').through(apifySource);
  for await (const result of pipeline.run()) {
    if (result.error !== null) {
      console.log(`[variant-c] ERR ${result.error.code}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[variant-c] OK atom ${result.data.id} title="${result.data.data.title}"`);
  }
}

await main();

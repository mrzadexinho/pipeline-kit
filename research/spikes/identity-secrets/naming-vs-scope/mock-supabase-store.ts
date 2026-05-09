// Cat VIII spike #5 leg-2 sub-(1) — mock Supabase Store.
// New fixture for this spike. Store-shaped stub that mirrors the kit's
// Store<T> contract minimally (id + put(atom, ctx)). Schema / get / list
// are out of scope — single-method spike. No real Supabase, no network,
// no real PostgREST.
//
// The factory takes a resolved service-role string (from the cell harness;
// either via flat resolve('supabase-service-role') or via
// scope('supabase').resolve('service-role') — same underlying name +
// same cache entry by construction) and closes over a "client" which is
// just the bearer string echoed back in the ingest console.log.

import { type Result, ok } from './mock-secrets-resolver.ts';

export interface SupabaseAtom {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: { jobId: string; status: number };
}

export type SupabaseStoreErrorCode = 'put_failed';

export interface SupabaseStoreError {
  type: 'supabase_store_error';
  code: SupabaseStoreErrorCode;
  message: string;
  param?: string;
}

// Spike-only StoreContext — minimal echo of PipelineContext (run_id,
// signal). Avoids importing the full kit ctx; spike fixtures stay flat.
export interface StoreContext {
  run_id: string;
  signal: AbortSignal;
}

export interface SupabaseStore {
  readonly id: string;
  put(
    atom: SupabaseAtom,
    ctx: StoreContext,
  ): Promise<Result<SupabaseAtom, SupabaseStoreError>>;
}

export interface SupabaseStoreFactoryOpts {
  // Resolved at FACTORY time → installed once on the upsert closure. In a
  // real Store this would be the PostgREST/Supabase client instance; for
  // the mock it's just the bearer string we echo on every put().
  serviceRoleKey: string;
}

export function createMockSupabaseStore(opts: SupabaseStoreFactoryOpts): SupabaseStore {
  const { serviceRoleKey } = opts;
  return {
    id: 'pk_store_supabase_naming_vs_scope',
    async put(atom, ctx) {
      // Yield to the event loop once — keeps the put() async-honest in
      // line with the leg-1 mock-resolver pattern.
      await Promise.resolve();
      console.log(
        `[supabase-store] UPSERT atom=${atom.id} run=${ctx.run_id} ` +
          `service_role=${serviceRoleKey} job_id=${atom.data.jobId}`,
      );
      return ok(atom);
    },
  };
}

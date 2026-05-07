import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { atom as atomId, run as runId, src as srcId } from '../src/ids.js';
import type {
  Atom,
  EmitResult,
  IdempotencySupport,
  ListResult,
  Process,
  Serve,
  Source,
  Store,
  StoreFilters,
} from '../src/stages/index.js';

describe('stage interfaces', () => {
  it('Atom<T> extends ResourceEnvelope with object: "atom"', () => {
    const atom: Atom<{ value: number }> = {
      id: atomId(),
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: {},
      data: { value: 42 },
      run_id: runId(),
      source_id: srcId(),
    };
    expect(atom.object).toBe('atom');
    expect(atom.data.value).toBe(42);
  });

  it('Source<O> structural shape compiles with iter + fetch', () => {
    const schema = z.object({ id: z.string() });
    type O = z.infer<typeof schema>;

    const source: Source<O> = {
      id: srcId(),
      schema,
      async *iter(_query, _ctx) {
        // intentional: structural sample
      },
      async fetch(_query, _ctx) {
        return { data: [], error: null };
      },
    };
    expect(source.id).toMatch(/^pk_src_/);
  });

  it('Store<T> structural shape compiles with put/get/list', () => {
    const schema = z.object({ id: z.string() });
    type T = z.infer<typeof schema>;

    const store: Store<T> = {
      id: 'pk_store_test',
      schema,
      async put(atom, _ctx) {
        return { data: atom, error: null };
      },
      async get(_id, _ctx) {
        return { data: null, error: null };
      },
      async list(_filters, _ctx) {
        const list: ListResult<Atom<T>> = { items: [], has_more: false };
        return { data: list, error: null };
      },
    };
    expect(store.id).toBe('pk_store_test');

    const filters: StoreFilters = { limit: 10 };
    expect(filters.limit).toBe(10);
  });

  it('Process<I,O> structural shape compiles with run', () => {
    const inputSchema = z.string();
    const outputSchema = z.number();

    const process: Process<string, number> = {
      id: 'pk_proc_test',
      inputSchema,
      outputSchema,
      async run(input, _ctx) {
        return { data: input.length, error: null };
      },
    };
    expect(process.id).toBe('pk_proc_test');
  });

  it('Serve<I> structural shape compiles with required idempotencySupport', () => {
    const schema = z.string();
    const supports: IdempotencySupport[] = ['required', 'optional', 'unsupported'];

    const serve: Serve<string> = {
      id: 'pk_serve_test',
      schema,
      idempotencySupport: 'required',
      async emit(_input, _ctx) {
        const out: EmitResult = {
          id: 'emit_xxx',
          emitted_at: new Date().toISOString(),
          metadata: {},
        };
        return { data: out, error: null };
      },
    };
    expect(serve.idempotencySupport).toBe('required');
    expect(supports).toContain(serve.idempotencySupport);
  });
});

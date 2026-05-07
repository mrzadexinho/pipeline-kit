import { describe, expect, it } from 'vitest';
import { atom, evt, ids, pipe, proc, review, run, serve, src } from '../src/ids.js';

const helpers = [
  { name: 'run', fn: run, prefix: 'pk_run_' },
  { name: 'atom', fn: atom, prefix: 'pk_atom_' },
  { name: 'evt', fn: evt, prefix: 'pk_evt_' },
  { name: 'pipe', fn: pipe, prefix: 'pk_pipe_' },
  { name: 'src', fn: src, prefix: 'pk_src_' },
  { name: 'proc', fn: proc, prefix: 'pk_proc_' },
  { name: 'serve', fn: serve, prefix: 'pk_serve_' },
  { name: 'review', fn: review, prefix: 'pk_review_' },
] as const;

describe('pk.ids', () => {
  for (const { name, fn, prefix } of helpers) {
    describe(name, () => {
      it(`returns ${prefix}<id> formatted string`, () => {
        const id = fn();
        expect(id.startsWith(prefix)).toBe(true);
        expect(id.length).toBeGreaterThan(prefix.length);
      });

      it('1000 generations are unique', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 1000; i++) {
          seen.add(fn());
        }
        expect(seen.size).toBe(1000);
      });
    });
  }

  it('exposes every helper through the ids namespace', () => {
    expect(ids.run).toBe(run);
    expect(ids.atom).toBe(atom);
    expect(ids.evt).toBe(evt);
    expect(ids.pipe).toBe(pipe);
    expect(ids.src).toBe(src);
    expect(ids.proc).toBe(proc);
    expect(ids.serve).toBe(serve);
    expect(ids.review).toBe(review);
  });
});

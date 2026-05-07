import { describe, expect, it } from 'vitest';
import { type ComposerStep, runComposer } from '../../src/composer/composer.js';
import type { PipelineContext } from '../../src/context.js';
import { atom as atomId, proc as procId, serve as serveId, src as srcId } from '../../src/ids.js';
import { err, ok } from '../../src/result.js';
import type { Atom } from '../../src/stages/atom.js';
import type { Source, SourceQuery } from '../../src/stages/source.js';

function buildAtom<T>(data: T): Atom<T> {
  return {
    id: atomId(),
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: {},
    data,
  };
}

function makeIterSource(atoms: Atom<unknown>[]): Source<unknown> {
  return {
    id: srcId(),
    schema: { parse: (v: unknown) => v } as never,
    async *iter(_query: SourceQuery, _ctx: PipelineContext) {
      for (const a of atoms) {
        yield a;
      }
    },
    async fetch() {
      return ok(atoms);
    },
  };
}

describe('fan-out — multi-atom process dispatch', () => {
  it('Process is invoked once per atom; atomCount equals emit count', async () => {
    const atoms = [buildAtom('a1'), buildAtom('a2'), buildAtom('a3')];
    const source = makeIterSource(atoms);
    const invocations: unknown[] = [];

    const processStep: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        invocations.push(input);
        return ok(`${String(input)}_processed`);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_process',
      steps: [processStep],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).toBeNull();
    expect(r.data?.atomCount).toBe(3);
    expect(invocations).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('fan-out — multi-atom serve dispatch', () => {
  it('Serve is invoked once per atom with distinct inputs', async () => {
    const atoms = [buildAtom('x1'), buildAtom('x2'), buildAtom('x3')];
    const source = makeIterSource(atoms);
    const emitted: unknown[] = [];

    const serveStep: ComposerStep = {
      id: serveId(),
      kind: 'serve',
      async run(input, _ctx) {
        emitted.push(input);
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_serve',
      steps: [serveStep],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).toBeNull();
    expect(emitted).toEqual(['x1', 'x2', 'x3']);
  });
});

describe('fan-out — atomCount on success', () => {
  it('atomCount reflects number of atoms yielded by source', async () => {
    const atoms = [buildAtom(1), buildAtom(2), buildAtom(3)];
    const source = makeIterSource(atoms);
    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_count',
      steps: [step],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).toBeNull();
    expect(r.data?.atomCount).toBe(3);
  });
});

describe('fan-out — output equals last atom output', () => {
  it('output is the processed result of the last atom', async () => {
    const atoms = [buildAtom('atom1'), buildAtom('atom2'), buildAtom('atom3')];
    const source = makeIterSource(atoms);
    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        return ok(`${String(input)}_processed`);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_last',
      steps: [step],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).toBeNull();
    expect(r.data?.output).toBe('atom3_processed');
  });
});

describe('fan-out — per-atom failure with metadata', () => {
  it('error on atom 2 includes metadata; atom 3 is not pulled', async () => {
    const atomA = buildAtom('atom1');
    const atomB = buildAtom('atom2');
    const atomC = buildAtom('atom3');

    let pullCount = 0;
    const source: Source<unknown> = {
      id: srcId(),
      schema: { parse: (v: unknown) => v } as never,
      async *iter() {
        pullCount++;
        yield atomA;
        pullCount++;
        yield atomB;
        pullCount++;
        yield atomC;
      },
      async fetch() {
        return ok([atomA, atomB, atomC]);
      },
    };

    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      retryPolicy: { maxAttempts: 1 },
      async run(input, _ctx) {
        if (input === 'atom2') {
          return err({ type: 'permanent', code: 'atom2_fail', message: 'atom2 error' });
        }
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_fail',
      steps: [step],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).not.toBeNull();
    expect(r.error?.type).toBe('process_failed');
    expect(r.error?.metadata?.atom_id).toBe(atomB.id);
    expect(r.error?.metadata?.atoms_attempted).toBe(2);
    expect(r.error?.metadata?.atoms_completed).toBe(1);
    expect(pullCount).toBe(2);
  });
});

describe('fan-out — cancellation mid-iteration', () => {
  it('cancels during atom 2 processing; atom 3 not pulled', async () => {
    const ac = new AbortController();
    const atomA = buildAtom('a1');
    const atomB = buildAtom('a2');
    const atomC = buildAtom('a3');

    let pullCount = 0;
    const source: Source<unknown> = {
      id: srcId(),
      schema: { parse: (v: unknown) => v } as never,
      async *iter() {
        pullCount++;
        yield atomA;
        pullCount++;
        yield atomB;
        pullCount++;
        yield atomC;
      },
      async fetch() {
        return ok([atomA, atomB, atomC]);
      },
    };

    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        if (input === 'a2') {
          ac.abort();
        }
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_cancel',
      steps: [step],
      source: { adapter: source, query: undefined },
      signal: ac.signal,
    });

    expect(r.error?.type).toBe('cancelled');
    expect(pullCount).toBeLessThanOrEqual(2);
  });
});

describe('fan-out — empty source', () => {
  it('empty iter returns source_failed with source_no_atoms code', async () => {
    const source: Source<unknown> = {
      id: srcId(),
      schema: { parse: (v: unknown) => v } as never,
      async *iter() {},
      async fetch() {
        return ok([]);
      },
    };

    const step: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_empty',
      steps: [step],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).not.toBeNull();
    expect(r.error?.code).toBe('source_no_atoms');
    expect(r.error?.type).toBe('source_failed');
  });
});

describe('fan-out — per-atom OTel spans (integration)', () => {
  it('3 atoms × 2 stages run without errors; OTel no-op provider does not throw', async () => {
    const atoms = [buildAtom('s1'), buildAtom('s2'), buildAtom('s3')];
    const source = makeIterSource(atoms);

    const processStep: ComposerStep = {
      id: procId(),
      kind: 'process',
      async run(input, _ctx) {
        return ok(`${String(input)}_p`);
      },
    };
    const serveStep: ComposerStep = {
      id: serveId(),
      kind: 'serve',
      async run(input, _ctx) {
        return ok(input);
      },
    };

    const r = await runComposer({
      pipelineId: 'pk_pipe_fan_out_otel',
      steps: [processStep, serveStep],
      source: { adapter: source, query: undefined },
    });

    expect(r.error).toBeNull();
    expect(r.data?.atomCount).toBe(3);
    expect(r.data?.output).toBe('s3_p');
  });
});

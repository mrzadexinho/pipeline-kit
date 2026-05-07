import type { PipelineContext } from '@pipeline-kit/core';
import { sign } from '@pipeline-kit/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createWebhookSource } from '../src/webhook-source.js';

const SECRET = 'iter-test-secret';
const PATH = '/webhooks/iter';
const ItemSchema = z.object({ id: z.number() });

function makeCtx(signal?: AbortSignal): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_iter',
    pipelineId: 'pk_pipe_iter',
    attempt: 1,
    metadata: meta,
    signal: signal ?? new AbortController().signal,
    trace: {} as never,
    attachMetadata: (k: string, v: unknown) => {
      meta[k] = v;
    },
  };
}

async function postAtom(
  app: ReturnType<typeof createWebhookSource>['app'],
  id: number,
): Promise<void> {
  const body = JSON.stringify({ id });
  const sig = sign(body, SECRET);
  const req = new Request(`http://localhost${PATH}`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Pipeline-Kit-Signature': sig,
    },
  });
  const res = await app.fetch(req);
  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}`);
  }
}

describe('iter() and buffer', () => {
  it('atoms buffered before iter is consumed — all yielded when iter starts', async () => {
    const source = createWebhookSource({
      path: PATH,
      secret: SECRET,
      schema: ItemSchema,
    });

    // Buffer 3 atoms before starting iteration
    await postAtom(source.app, 1);
    await postAtom(source.app, 2);
    await postAtom(source.app, 3);

    const ac = new AbortController();
    const ctx = makeCtx(ac.signal);

    const collected: number[] = [];

    // Collect atoms until we have 3, then abort
    for await (const atomItem of source.iter(undefined, ctx)) {
      collected.push(atomItem.data.id);
      if (collected.length === 3) {
        ac.abort();
        break;
      }
    }

    expect(collected).toHaveLength(3);
    expect(collected).toEqual([1, 2, 3]);
  });

  it('cancellation: ctx.signal.abort() stops iter without throwing', async () => {
    const source = createWebhookSource({
      path: PATH,
      secret: SECRET,
      schema: ItemSchema,
    });

    const ac = new AbortController();
    const ctx = makeCtx(ac.signal);

    const collected: number[] = [];

    // Start iterating in background
    const iterPromise = (async () => {
      for await (const atomItem of source.iter(undefined, ctx)) {
        collected.push(atomItem.data.id);
      }
    })();

    // Push one atom, then abort
    await postAtom(source.app, 10);

    // Give the iterator a tick to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    ac.abort();

    // Should resolve cleanly without throwing
    await expect(iterPromise).resolves.toBeUndefined();

    // We may or may not have collected the atom depending on timing,
    // but the iterator must have stopped.
    expect(collected.length).toBeLessThanOrEqual(1);
  });

  it('fetch() returns snapshot and clears buffer', async () => {
    const source = createWebhookSource({
      path: PATH,
      secret: SECRET,
      schema: ItemSchema,
    });

    const ctx = makeCtx();

    // Buffer 2 atoms
    await postAtom(source.app, 100);
    await postAtom(source.app, 200);

    const result1 = await source.fetch(undefined, ctx);
    expect(result1.error).toBeNull();
    expect(result1.data).toHaveLength(2);

    // Second fetch should be empty (buffer was drained)
    const result2 = await source.fetch(undefined, ctx);
    expect(result2.error).toBeNull();
    expect(result2.data).toHaveLength(0);
  });
});

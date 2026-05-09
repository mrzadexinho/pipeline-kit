import type { PipelineContext, ReviewableConfig } from '@idriszade/core';
import { describe, expect, it, vi } from 'vitest';
import { GatewerkReviewable } from '../src/gatewerk-reviewable.js';

interface ReviewDetailLike {
  id: string;
  status: string;
  decision?: string;
  feedback?: string;
  edited_payload?: Record<string, unknown>;
  decided_by?: string;
}

interface GatewerkClientLike {
  reviews: {
    create: (input: unknown) => Promise<{ data: { id: string } | null; error: unknown }>;
    get: (id: string) => Promise<{ data: ReviewDetailLike | null; error: unknown }>;
  };
}

const fakeCtx = (): PipelineContext => ({
  runId: 'pk_run_x',
  pipelineId: 'pk_pipe_x',
  attempt: 1,
  metadata: {},
  signal: new AbortController().signal,
  trace: undefined as never,
  attachMetadata() {},
});

const baseConfig: ReviewableConfig = {
  allowApprove: true,
  allowReject: true,
  allowEdit: true,
  allowRetry: true,
  allowIgnore: true,
};

const makeClient = (
  detail: ReviewDetailLike | null,
  opts?: { failGet?: boolean; failCreate?: boolean },
): GatewerkClientLike => {
  return {
    reviews: {
      create: vi.fn(async () => {
        if (opts?.failCreate) {
          return { data: null, error: { message: 'create failed' } };
        }
        return { data: { id: 'rv_test_id' }, error: null };
      }),
      get: vi.fn(async () => {
        if (opts?.failGet) {
          return { data: null, error: { message: 'get failed' } };
        }
        return { data: detail, error: null };
      }),
    },
  };
};

describe('GatewerkReviewable — 5 mocked-transport scenarios', () => {
  it('approve: detail.decision="approved" maps to approved response', async () => {
    const client = makeClient({
      id: 'rv_test_id',
      status: 'decided',
      decision: 'approved',
      decided_by: 'reviewer@example.com',
    });
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });
    const r = await reviewable.review({ name: 'Idris' }, fakeCtx());
    expect(r.error).toBeNull();
    expect(r.data?.[0]?.decision).toBe('approved');
    if (r.data?.[0]?.decision === 'approved') {
      expect(r.data[0].wasEdited).toBe(false);
      expect(r.data[0].value).toEqual({ name: 'Idris' });
      expect(r.data[0].reviewer).toBe('reviewer@example.com');
    }
  });

  it('approve-with-edit: edited_payload populates value + wasEdited true', async () => {
    const client = makeClient({
      id: 'rv_test_id',
      status: 'decided',
      decision: 'approved',
      edited_payload: { name: 'Idris (edited)' },
    });
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });
    const r = await reviewable.review({ name: 'Idris' }, fakeCtx());
    expect(r.error).toBeNull();
    if (r.data?.[0]?.decision === 'approved') {
      expect(r.data[0].wasEdited).toBe(true);
      expect(r.data[0].value).toEqual({ name: 'Idris (edited)' });
    }
  });

  it('reject: detail.decision="rejected" maps to rejected with feedback', async () => {
    const client = makeClient({
      id: 'rv_test_id',
      status: 'decided',
      decision: 'rejected',
      feedback: 'not appropriate',
    });
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });
    const r = await reviewable.review({ name: 'Idris' }, fakeCtx());
    expect(r.data?.[0]?.decision).toBe('rejected');
    if (r.data?.[0]?.decision === 'rejected') {
      expect(r.data[0].reason).toBe('not appropriate');
    }
  });

  it('retry: detail.decision="retry" maps to retry with feedback', async () => {
    const client = makeClient({
      id: 'rv_test_id',
      status: 'decided',
      decision: 'retry',
      feedback: 'try again with more detail',
    });
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });
    const r = await reviewable.review({ name: 'Idris' }, fakeCtx());
    expect(r.data?.[0]?.decision).toBe('retry');
    if (r.data?.[0]?.decision === 'retry') {
      expect(r.data[0].feedback).toBe('try again with more detail');
    }
  });

  it('timeout: no decision before timeoutMs returns timeout ReviewError', async () => {
    const client = makeClient({
      id: 'rv_test_id',
      status: 'pending',
    });
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 10,
      timeoutMs: 30,
    });
    const r = await reviewable.review({ name: 'Idris' }, fakeCtx());
    expect(r.error?.type).toBe('timeout');
    expect(r.error?.code).toBe('gatewerk_poll_timeout');
  });
});

describe('GatewerkReviewable — error wrapping', () => {
  it('reviews.create error becomes transport ReviewError', async () => {
    const client = makeClient(null, { failCreate: true });
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 5,
      timeoutMs: 100,
    });
    const r = await reviewable.review({ name: 'Idris' }, fakeCtx());
    expect(r.error?.type).toBe('transport');
    expect(r.error?.code).toBe('gatewerk_create_failed');
  });

  it('cancellation via signal returns cancelled ReviewError', async () => {
    const client = makeClient({ id: 'rv_test_id', status: 'pending' });
    const ac = new AbortController();
    const ctx: PipelineContext = { ...fakeCtx(), signal: ac.signal };
    const reviewable = new GatewerkReviewable<{ name: string }>({
      client: client as never,
      templateId: 'tpl_test',
      config: baseConfig,
      pollIntervalMs: 50,
      timeoutMs: 5_000,
    });
    setTimeout(() => ac.abort(), 20);
    const r = await reviewable.review({ name: 'Idris' }, ctx);
    expect(r.error?.type).toBe('cancelled');
  });
});

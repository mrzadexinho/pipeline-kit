import type { PipelineContext } from '@idriszade/core';
import { describe, expect, it } from 'vitest';
import { ConsoleReviewable } from '../src/console-reviewable.js';

const fakeCtx = (): PipelineContext => ({
  runId: 'pk_run_x',
  pipelineId: 'pk_pipe_x',
  attempt: 1,
  metadata: {},
  signal: new AbortController().signal,
  trace: undefined as never,
  attachMetadata() {},
});

describe('ConsoleReviewable', () => {
  it('non-TTY environment returns unsupported ReviewError (CI does not hang)', async () => {
    const reviewable = new ConsoleReviewable<string>({
      isTty: () => false,
      read: async () => 'a',
    });
    const r = await reviewable.review('hi', fakeCtx());
    expect(r.error?.type).toBe('unsupported');
    expect(r.error?.code).toBe('console_non_tty');
  });

  it('TTY true with mocked stdin "a" returns approved', async () => {
    const lines: string[] = [];
    const reviewable = new ConsoleReviewable<string>({
      isTty: () => true,
      read: async () => 'a\n',
      output: (line) => lines.push(line),
    });
    const r = await reviewable.review('hello', fakeCtx());
    expect(r.error).toBeNull();
    expect(r.data?.[0]?.decision).toBe('approved');
    if (r.data?.[0]?.decision === 'approved') {
      expect(r.data[0].value).toBe('hello');
    }
    expect(lines).toContain('[a]pprove [r]eject [e]dit [q]retry [i]gnore');
  });

  it('TTY true with mocked stdin "r" returns rejected', async () => {
    const reviewable = new ConsoleReviewable<string>({
      isTty: () => true,
      read: async () => 'r',
      output: () => {},
    });
    const r = await reviewable.review('hi', fakeCtx());
    expect(r.data?.[0]?.decision).toBe('rejected');
  });

  it('TTY true with mocked stdin "q" returns retry', async () => {
    const reviewable = new ConsoleReviewable<string>({
      isTty: () => true,
      read: async () => 'q',
      output: () => {},
    });
    const r = await reviewable.review('hi', fakeCtx());
    expect(r.data?.[0]?.decision).toBe('retry');
  });

  it('unknown response defaults to ignored with diagnostic reason', async () => {
    const reviewable = new ConsoleReviewable<string>({
      isTty: () => true,
      read: async () => 'gibberish',
      output: () => {},
    });
    const r = await reviewable.review('hi', fakeCtx());
    expect(r.data?.[0]?.decision).toBe('ignored');
  });
});

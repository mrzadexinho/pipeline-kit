import {
  err,
  ok,
  type PipelineContext,
  type Result,
  type Reviewable,
  type ReviewableConfig,
  type ReviewError,
  type ReviewResponse,
  review as reviewId,
} from '@idriszade/core';

// Structural type for the gatewerk SDK client. Kit declares the exact shape
// it consumes so users can pass an instance of `gatewerk`'s GatewerkClient
// (peer-dep-optional) without process-reviewable carrying a build-time dep
// on the gatewerk package.
export interface GatewerkClient {
  reviews: {
    create(input: {
      template: string;
      payload: Record<string, unknown>;
      callback_url: string;
    }): Promise<Result<{ id?: string }, { message?: string }>>;
    get(id: string): Promise<Result<ReviewDetailLike, { message?: string }>>;
  };
}

export interface GatewerkReviewableOpts<I> {
  client: GatewerkClient;
  templateId: string;
  config: ReviewableConfig;
  callbackUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  toPayload?: (input: I) => Record<string, unknown>;
  fromPayload?: (payload: Record<string, unknown>) => I;
}

interface ReviewDetailLike {
  decision?: string;
  feedback?: string;
  edited_payload?: Record<string, unknown>;
  decided_by?: string;
}

interface CreateResultLike {
  id?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 60_000;

export class GatewerkReviewable<I> implements Reviewable<I> {
  readonly id: string;
  readonly config: ReviewableConfig;
  private readonly client: GatewerkClient;
  private readonly templateId: string;
  private readonly callbackUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly toPayload: (input: I) => Record<string, unknown>;
  private readonly fromPayload: (payload: Record<string, unknown>) => I;

  constructor(opts: GatewerkReviewableOpts<I>) {
    this.id = reviewId();
    this.client = opts.client;
    this.templateId = opts.templateId;
    this.config = opts.config;
    this.callbackUrl = opts.callbackUrl ?? '';
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.toPayload = opts.toPayload ?? ((input) => input as unknown as Record<string, unknown>);
    this.fromPayload = opts.fromPayload ?? ((payload) => payload as unknown as I);
  }

  describe(input: I): string {
    return `Gatewerk review (template=${this.templateId}) for ${JSON.stringify(input)}`;
  }

  async review(input: I, ctx: PipelineContext): Promise<Result<ReviewResponse<I>[], ReviewError>> {
    const createResult = await this.client.reviews.create({
      template: this.templateId,
      payload: this.toPayload(input),
      callback_url: this.callbackUrl,
    });
    if (createResult.error !== null) {
      return err({
        type: 'transport',
        code: 'gatewerk_create_failed',
        message: createResult.error.message ?? 'gatewerk reviews.create failed',
      });
    }
    const created = createResult.data as CreateResultLike;
    if (typeof created.id !== 'string' || created.id === '') {
      return err({
        type: 'transport',
        code: 'gatewerk_no_id',
        message: 'gatewerk reviews.create did not return an id',
      });
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      if (ctx.signal.aborted) {
        return err({
          type: 'cancelled',
          code: 'review_aborted',
          message: 'review aborted via PipelineContext.signal',
        });
      }
      const getResult = await this.client.reviews.get(created.id);
      if (getResult.error !== null) {
        return err({
          type: 'transport',
          code: 'gatewerk_get_failed',
          message: getResult.error.message ?? 'gatewerk reviews.get failed',
        });
      }
      const detail = getResult.data as ReviewDetailLike;
      if (typeof detail.decision === 'string' && detail.decision !== '') {
        return ok([this.mapDecision(input, detail)]);
      }
      await this.sleep(this.pollIntervalMs, ctx.signal);
    }
    return err({
      type: 'timeout',
      code: 'gatewerk_poll_timeout',
      message: `gatewerk review did not decide within ${this.timeoutMs}ms`,
    });
  }

  private mapDecision(input: I, detail: ReviewDetailLike): ReviewResponse<I> {
    const reviewer = detail.decided_by;
    switch (detail.decision) {
      case 'approved':
      case 'approve': {
        const wasEdited = detail.edited_payload !== undefined;
        const valuePayload = detail.edited_payload ?? this.toPayload(input);
        const response: ReviewResponse<I> = {
          decision: 'approved',
          value: this.fromPayload(valuePayload),
          wasEdited,
        };
        if (reviewer !== undefined) response.reviewer = reviewer;
        return response;
      }
      case 'rejected':
      case 'reject': {
        const response: ReviewResponse<I> = { decision: 'rejected' };
        if (detail.feedback !== undefined) response.reason = detail.feedback;
        if (reviewer !== undefined) response.reviewer = reviewer;
        return response;
      }
      case 'retry': {
        const response: ReviewResponse<I> = { decision: 'retry' };
        if (detail.feedback !== undefined) response.feedback = detail.feedback;
        if (reviewer !== undefined) response.reviewer = reviewer;
        return response;
      }
      case 'ignored':
      case 'ignore': {
        const response: ReviewResponse<I> = { decision: 'ignored' };
        if (detail.feedback !== undefined) response.reason = detail.feedback;
        return response;
      }
      default:
        return {
          decision: 'ignored',
          reason: `gatewerk returned unknown decision: ${detail.decision ?? 'undefined'}`,
        };
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

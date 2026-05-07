import type { PipelineContext } from './context.js';
import type { ReviewError } from './errors/review.js';
import type { Result } from './result.js';

export interface ReviewableConfig {
  allowApprove: boolean;
  allowReject: boolean;
  allowEdit: boolean;
  allowRetry: boolean;
  allowIgnore: boolean;
}

export type ReviewResponse<I> =
  | { decision: 'approved'; value: I; wasEdited: boolean; reviewer?: string }
  | { decision: 'rejected'; reason?: string; reviewer?: string }
  | { decision: 'retry'; feedback?: string; reviewer?: string }
  | { decision: 'ignored'; reason?: string };

export interface Reviewable<I> {
  readonly id: string;
  readonly config: ReviewableConfig;
  describe(input: I): string;
  review(input: I, ctx: PipelineContext): Promise<Result<ReviewResponse<I>[], ReviewError>>;
}

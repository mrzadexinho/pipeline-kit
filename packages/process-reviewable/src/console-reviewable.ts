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

export interface ConsoleReviewableOpts<I> {
  config?: Partial<ReviewableConfig>;
  describe?: (input: I) => string;
  read?: () => Promise<string>;
  isTty?: () => boolean;
  output?: (line: string) => void;
}

const DEFAULT_CONFIG: ReviewableConfig = {
  allowApprove: true,
  allowReject: true,
  allowEdit: false,
  allowRetry: true,
  allowIgnore: true,
};

export class ConsoleReviewable<I> implements Reviewable<I> {
  readonly id: string;
  readonly config: ReviewableConfig;
  private readonly describeFn: (input: I) => string;
  private readonly read: () => Promise<string>;
  private readonly isTty: () => boolean;
  private readonly output: (line: string) => void;

  constructor(opts?: ConsoleReviewableOpts<I>) {
    this.id = reviewId();
    this.config = { ...DEFAULT_CONFIG, ...opts?.config };
    this.describeFn = opts?.describe ?? ((input) => JSON.stringify(input));
    this.read = opts?.read ?? defaultRead;
    this.isTty = opts?.isTty ?? (() => process.stdin.isTTY === true);
    this.output = opts?.output ?? ((line) => process.stdout.write(`${line}\n`));
  }

  describe(input: I): string {
    return this.describeFn(input);
  }

  async review(input: I, _ctx: PipelineContext): Promise<Result<ReviewResponse<I>[], ReviewError>> {
    if (!this.isTty()) {
      return err({
        type: 'unsupported',
        code: 'console_non_tty',
        message: 'ConsoleReviewable requires an interactive TTY (process.stdin.isTTY === true)',
      });
    }

    this.output(this.describeFn(input));
    this.output('[a]pprove [r]eject [e]dit [q]retry [i]gnore');
    const answer = (await this.read()).trim().toLowerCase();

    return ok([this.parseAnswer(answer, input)]);
  }

  private parseAnswer(answer: string, input: I): ReviewResponse<I> {
    switch (answer) {
      case 'a':
      case 'approve':
        return { decision: 'approved', value: input, wasEdited: false, reviewer: 'console' };
      case 'r':
      case 'reject':
        return {
          decision: 'rejected',
          reason: 'rejected by console reviewer',
          reviewer: 'console',
        };
      case 'q':
      case 'retry':
        return { decision: 'retry', reviewer: 'console' };
      case 'i':
      case 'ignore':
        return { decision: 'ignored' };
      default:
        return { decision: 'ignored', reason: `unknown console response: ${answer}` };
    }
  }
}

function defaultRead(): Promise<string> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer | string) => {
      process.stdin.removeListener('data', onData);
      resolve(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    };
    process.stdin.once('data', onData);
  });
}

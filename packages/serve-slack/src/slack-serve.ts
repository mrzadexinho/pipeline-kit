import { createHash, randomUUID } from 'node:crypto';
import {
  type Atom,
  type EmitResult,
  err,
  ok,
  type PipelineContext,
  type Result,
  type RetryPolicy,
  type Serve,
  type ServeError,
  type Store,
  type TokenBucketConfig,
} from '@idriszade/core';
import { WebClient } from '@slack/web-api';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// SlackMessage schema
// ---------------------------------------------------------------------------

export const SlackMessage = z.object({
  text: z.string(),
  blocks: z.array(z.unknown()).optional(),
  thread_ts: z.string().optional(),
  unfurl_links: z.boolean().default(false),
  unfurl_media: z.boolean().default(false),
});

export type SlackMessage = z.infer<typeof SlackMessage>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SlackServeConfig {
  id?: string;
  token: string;
  channel: string;
  idempotencyCache?: Store<{ ts: string; channel: string }>;
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveClientMsgId(idempotencyKey: string): string {
  const hex = createHash('sha256').update(idempotencyKey).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function generateEmitId(): string {
  return `pk_emit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function classifySlackError(e: unknown): ServeError {
  if (!(e instanceof Error)) {
    return { type: 'unknown', code: 'slack_unknown', message: String(e) };
  }
  const msg = e.message.toLowerCase();
  if (
    msg.includes('invalid_auth') ||
    msg.includes('not_authed') ||
    msg.includes('account_inactive')
  ) {
    return { type: 'auth', code: 'slack_auth_error', message: e.message };
  }
  if (msg.includes('ratelimited') || msg.includes('rate_limited')) {
    return { type: 'rate_limited', code: 'slack_rate_limited', message: e.message };
  }
  return { type: 'transient', code: 'slack_transient', message: e.message };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSlackServe(config: SlackServeConfig): Serve<SlackMessage> {
  const token = config.token ?? process.env['SLACK_BOT_TOKEN'] ?? '';
  if (!token) {
    throw new Error(
      'SlackServe: token is required. Pass config.token or set SLACK_BOT_TOKEN env var.',
    );
  }

  const id = config.id ?? generateEmitId();
  const client = new WebClient(token);

  return {
    id,
    schema: SlackMessage,
    idempotencySupport: 'optional',
    retryPolicy: config.retryPolicy,
    rateLimit: config.rateLimit,

    async emit(input: SlackMessage, ctx: PipelineContext): Promise<Result<EmitResult, ServeError>> {
      // 1. Validate input
      const parsed = SlackMessage.safeParse(input);
      if (!parsed.success) {
        return err({
          type: 'validation',
          code: 'slack_validation_error',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        } as ServeError);
      }

      const msg = parsed.data;

      // 2. Derive client msg id
      const derivedMsgId = ctx.idempotencyKey
        ? deriveClientMsgId(ctx.idempotencyKey)
        : randomUUID();

      // 3. Check idempotency cache
      if (config.idempotencyCache && ctx.idempotencyKey) {
        const cacheResult = await config.idempotencyCache.get(ctx.idempotencyKey, ctx);
        if (cacheResult.error !== null) {
          // Store read error — treat as cache miss and proceed with postMessage
          // (don't fail the emit on a cache read error)
        } else if (cacheResult.data !== null && cacheResult.data !== undefined) {
          const cached = cacheResult.data;
          return ok({
            id: cached.data.ts,
            emitted_at: cached.created_at,
            metadata: { channel: cached.data.channel },
          });
        }
      }

      // 4. Call Slack API
      try {
        const response = await client.chat.postMessage({
          channel: config.channel,
          text: msg.text,
          ...(msg.blocks !== undefined && { blocks: msg.blocks }),
          ...(msg.thread_ts !== undefined && { thread_ts: msg.thread_ts }),
          unfurl_links: msg.unfurl_links,
          unfurl_media: msg.unfurl_media,
          ...(ctx.idempotencyKey ? { client_msg_id: derivedMsgId } : {}),
        });

        const ts = response.ts ?? derivedMsgId;

        // 5. Write to idempotency cache
        if (config.idempotencyCache && ctx.idempotencyKey) {
          const cacheAtom: Atom<{ ts: string; channel: string }> = {
            id: ctx.idempotencyKey,
            object: 'atom',
            created_at: new Date().toISOString(),
            metadata: {},
            data: { ts, channel: config.channel },
          };
          await config.idempotencyCache.put(cacheAtom, ctx);
        }

        // 6. Return success
        return ok({
          id: ts,
          emitted_at: new Date().toISOString(),
          metadata: { channel: config.channel },
        });
      } catch (e) {
        return err(classifySlackError(e));
      }
    },
  };
}

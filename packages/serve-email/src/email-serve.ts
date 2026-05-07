import {
  err,
  ok,
  type EmitResult,
  type PipelineContext,
  type Result,
  type RetryPolicy,
  type ServeError,
  type Serve,
} from '@pipeline-kit/core';
import { z } from 'zod';
import { generateEmitId, makeServeError } from './internal.js';
import { sendSmtp } from './providers/smtp.js';
import { sendPostal } from './providers/postal.js';
import { sendResend } from './providers/resend.js';

// ---------------------------------------------------------------------------
// EmailMessage schema
// ---------------------------------------------------------------------------

export const EmailMessage = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string(),
  html: z.string().optional(),
  text: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  attachments: z
    .array(z.object({ filename: z.string(), content: z.string() }))
    .optional(),
});

export type EmailMessage = z.infer<typeof EmailMessage>;

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export type SmtpConfig = {
  host: string;
  port: number;
  secure?: boolean;
  auth: { user: string; pass: string };
};

export type PostalConfig = {
  apiUrl: string;
  apiKey: string;
};

export type ResendConfig = {
  apiKey: string;
};

type BaseEmailConfig = {
  from: string;
  idempotencyHeader?: string;
  id?: string;
  retryPolicy?: Partial<RetryPolicy>;
};

export type EmailServeConfigSmtp = BaseEmailConfig & {
  provider: 'smtp';
  smtp: SmtpConfig;
};

export type EmailServeConfigPostal = BaseEmailConfig & {
  provider: 'postal';
  postal: PostalConfig;
};

export type EmailServeConfigResend = BaseEmailConfig & {
  provider: 'resend';
  resend: ResendConfig;
};

export type EmailServeConfig =
  | EmailServeConfigSmtp
  | EmailServeConfigPostal
  | EmailServeConfigResend;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEmailServe(config: EmailServeConfig): Serve<EmailMessage> {
  const id = config.id ?? generateEmitId();

  return {
    id,
    schema: EmailMessage,
    idempotencySupport: 'required',
    retryPolicy: config.retryPolicy,

    async emit(input: EmailMessage, ctx: PipelineContext): Promise<Result<EmitResult, ServeError>> {
      // Validate input
      const parsed = EmailMessage.safeParse(input);
      if (!parsed.success) {
        return err(
          makeServeError(
            'validation',
            'email_validation_error',
            parsed.error.issues.map((i) => i.message).join('; '),
          ),
        );
      }

      const validInput = parsed.data;

      switch (config.provider) {
        case 'smtp':
          return sendSmtp(config, validInput, ctx);
        case 'postal':
          return sendPostal(config, validInput, ctx);
        case 'resend':
          return sendResend(config, validInput, ctx);
        default: {
          const _exhaustive: never = config;
          void _exhaustive;
          return err(makeServeError('unsupported', 'unknown_provider', 'Unknown email provider'));
        }
      }
    },
  };
}

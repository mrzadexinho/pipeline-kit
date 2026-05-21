import type { ErrorEnvelope } from '../envelope.js';

export type WebhookAlgorithm = 'v1' | 'v2';

// ---- verifyWebhook types ----

/** Options for the general-purpose {@link verifyWebhook} function. */
export interface VerifyWebhookOptions {
  /** Timestamp drift tolerance in milliseconds. Default: 300_000 (300s). */
  tolerance?: number;
  /** Signature prefix in the header (e.g. `'v1'`, `'sha256'`). Default: `'v1'`. */
  prefix?: string;
}

/** Error code returned by {@link verifyWebhook}. */
export type VerifyErrorCode = 'signature_mismatch' | 'timestamp_expired' | 'malformed_header';

/** Structured error returned by {@link verifyWebhook} inside `Result.error`. */
export interface VerifyError {
  code: VerifyErrorCode;
  message: string;
}

export interface SignOptions {
  timestamp?: Date;
  algorithm?: WebhookAlgorithm;
}

export interface VerifyOptions {
  tolerance?: number;
  acceptedAlgorithms?: ReadonlyArray<WebhookAlgorithm>;
}

export interface RunCreatedData {
  run_id: string;
  pipeline_id: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface RunCompletedData {
  run_id: string;
  pipeline_id: string;
  completed_at: string;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface RunFailedData {
  run_id: string;
  pipeline_id: string;
  failed_at: string;
  error: ErrorEnvelope;
  metadata?: Record<string, unknown>;
}

export interface ReviewCreatedData {
  review_id: string;
  template_id: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewDecidedData {
  review_id: string;
  decision: string;
  decided_at: string;
  decided_by?: string;
  metadata?: Record<string, unknown>;
}

export type PipelineKitEvent =
  | { type: 'pipeline.run.created'; data: RunCreatedData }
  | { type: 'pipeline.run.completed'; data: RunCompletedData }
  | { type: 'pipeline.run.failed'; data: RunFailedData }
  | { type: 'review.created'; data: ReviewCreatedData }
  | { type: 'review.decided'; data: ReviewDecidedData };

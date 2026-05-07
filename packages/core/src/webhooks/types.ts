import type { ErrorEnvelope } from '../envelope.js';

export type WebhookAlgorithm = 'v1' | 'v2';

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

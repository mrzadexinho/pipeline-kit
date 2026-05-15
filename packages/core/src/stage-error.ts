export type StageErrorCode =
  | 'source_unavailable'
  | 'source_timeout'
  | 'source_auth_failed'
  | 'source_schema_invalid'
  | 'process_failed'
  | 'process_timeout'
  | 'process_invalid_output'
  | 'serve_failed'
  | 'serve_timeout'
  | 'serve_auth_failed'
  | 'serve_idempotency_conflict'
  | 'gate_rejected'
  | 'gate_timeout'
  | 'gate_hold_expired'
  | 'runtime_retry_exhausted'
  | 'runtime_cancelled'
  | 'runtime_concurrency_rejected'
  | 'resource_expired'
  | 'runtime_budget_exceeded';

export interface StageError {
  type: 'stage_error';
  code: StageErrorCode;
  message: string;
  param?: string;
  doc_url?: string;
  retryable?: boolean;
}

export const RETRYABILITY_MAP: Map<StageErrorCode, 'always' | 'never' | 'unknown'> = new Map([
  ['source_unavailable', 'always'],
  ['source_timeout', 'always'],
  ['source_auth_failed', 'never'],
  ['source_schema_invalid', 'never'],
  ['process_failed', 'unknown'],
  ['process_timeout', 'always'],
  ['process_invalid_output', 'never'],
  ['serve_failed', 'unknown'],
  ['serve_timeout', 'always'],
  ['serve_auth_failed', 'never'],
  ['serve_idempotency_conflict', 'never'],
  ['gate_rejected', 'never'],
  ['gate_timeout', 'always'],
  ['gate_hold_expired', 'always'],
  ['runtime_retry_exhausted', 'never'],
  ['runtime_cancelled', 'never'],
  ['runtime_concurrency_rejected', 'always'],
  ['resource_expired', 'always'],
  ['runtime_budget_exceeded', 'never'],
]);

export function isRetryable(code: StageErrorCode): boolean | null {
  const verdict = RETRYABILITY_MAP.get(code);
  if (verdict === 'always') return true;
  if (verdict === 'never') return false;
  return null;
}

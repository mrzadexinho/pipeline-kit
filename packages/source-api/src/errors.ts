import type { SourceError } from '@pipeline-kit/core';

export function httpStatusToSourceError(status: number, body: string): SourceError {
  if (status === 401 || status === 403) {
    return {
      type: 'auth',
      code: `http_${status}`,
      message: `HTTP ${status}: ${body.slice(0, 200)}`,
    };
  }
  if (status === 429) {
    return {
      type: 'rate_limited',
      code: 'http_429',
      message: `HTTP 429: ${body.slice(0, 200)}`,
    };
  }
  if (status >= 500) {
    return {
      type: 'transient',
      code: `http_${status}`,
      message: `HTTP ${status}: ${body.slice(0, 200)}`,
    };
  }
  return {
    type: 'validation',
    code: `http_${status}`,
    message: `HTTP ${status}: ${body.slice(0, 200)}`,
  };
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function networkError(message: string): SourceError {
  return { type: 'network', code: 'network_error', message };
}

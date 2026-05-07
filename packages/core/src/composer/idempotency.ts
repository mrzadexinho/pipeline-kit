import { evt } from '../ids.js';

export function generateIdempotencyKey(): string {
  return evt();
}

export interface ServeIdempotencyScope {
  runId: string;
  serveAdapterId: string;
  atomId: string;
}

export function scopedIdempotencyKey(scope: ServeIdempotencyScope): string {
  return `${scope.runId}:${scope.serveAdapterId}:${scope.atomId}`;
}

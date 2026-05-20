import { type Attributes, type Context, SpanStatusCode, type Tracer, context, trace } from '@opentelemetry/api';
import type { Result } from '../result.js';

export type StageName = 'source' | 'process' | 'serve' | 'store' | 'review' | 'run';

/** OTel span attribute key for JSON-serialised PII annotations (ADR VIII-6.f). */
export const PII_ANNOTATIONS_ATTR = 'pk.pii_annotations' as const;

export interface SpanAttributes {
  runId: string;
  pipelineId: string;
  attempt?: number;
  stageId?: string;
  atomId?: string;
  [key: string]: unknown;
}

const TRACER_NAME = '@idriszade/core';

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export function withSpan<T, E extends { type: string; message: string }>(
  stage: StageName,
  attrs: SpanAttributes,
  parentCtx: Context | undefined,
  fn: () => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  const tracer = getTracer();
  const parentContext = parentCtx ?? context.active();
  return tracer.startActiveSpan(
    `pipeline.${stage}`,
    { attributes: toAttributes(attrs) },
    parentContext,
    async (span) => {
      try {
        const r = await fn();
        if (r.error === null) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: r.error.message });
          span.setAttribute('error.type', r.error.type);
        }
        return r;
      } catch (e) {
        span.recordException(e instanceof Error ? e : new Error(String(e)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}

function toAttributes(attrs: SpanAttributes): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

import { SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = '@pipeline-kit/process-extract';

export async function withExtractSpan<T>(
  provider: string,
  model: string,
  fn: (
    setUsage: (inputTokens: number, outputTokens: number, finishReasons: string[]) => void,
  ) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    'pipeline.process.extract',
    {
      attributes: {
        'gen_ai.system': provider,
        'gen_ai.request.model': model,
      },
    },
    async (span) => {
      try {
        const result = await fn((inputTokens, outputTokens, finishReasons) => {
          span.setAttribute('gen_ai.usage.input_tokens', inputTokens);
          span.setAttribute('gen_ai.usage.output_tokens', outputTokens);
          span.setAttribute('gen_ai.response.finish_reasons', finishReasons.join(','));
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
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

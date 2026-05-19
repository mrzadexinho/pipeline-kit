// B1 — OTel GenAI v1.37 semantic convention keys
export {
  GEN_AI_SYSTEM,
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_REQUEST_TEMPERATURE,
  GEN_AI_REQUEST_MAX_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_RESPONSE_ID,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
  CACHE_SUB_FIELDS,
  REASONING_SUB_FIELDS,
  isCacheSubField,
  isReasoningSubField,
} from './otel-genai-keys.js';
export type { GenAIAttributeKey } from './otel-genai-keys.js';

// B2 — KitSpanExporter
export { KitSpanExporter } from './exporter.js';
export type { SpanSink, KitSpanRecord } from './exporter.js';

// B3 — W3C Trace Context serde + NDJSON frame envelope
export {
  serializeTraceContext,
  parseTraceContext,
  wrapFrame,
  unwrapFrame,
} from './trace-context.js';
export type { WireTraceContext, NDJSONFrame } from './trace-context.js';

// B5 — File sink
export { FileSinkExporter } from './file-sink.js';
export type { FileSinkOptions } from './file-sink.js';

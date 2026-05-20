// B1 — OTel GenAI v1.37 semantic convention keys

export type { KitSpanRecord, SpanSink } from './exporter.js';
// B2 — KitSpanExporter
export { KitSpanExporter } from './exporter.js';
export type { FileSinkOptions } from './file-sink.js';
// B5 — File sink
export { FileSinkExporter } from './file-sink.js';
// M4 — known-sensitive table
export { KNOWN_SENSITIVE } from './known-sensitive.js';
export type { GenAIAttributeKey } from './otel-genai-keys.js';
export {
  CACHE_SUB_FIELDS,
  GEN_AI_COMPLETION,
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROMPT,
  GEN_AI_REQUEST_MAX_TOKENS,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_REQUEST_TEMPERATURE,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_ID,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SYSTEM,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_READ,
  GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE,
  GEN_AI_USAGE_INPUT_TOKENS_NO_CACHE,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS_REASONING,
  GEN_AI_USAGE_OUTPUT_TOKENS_TEXT,
  isCacheSubField,
  isReasoningSubField,
  REASONING_SUB_FIELDS,
} from './otel-genai-keys.js';
// M4 — RedactingProcessor
export type { RedactingProcessorOptions } from './redacting-processor.js';
export { PII_ANNOTATIONS_ATTR, RedactingProcessor } from './redacting-processor.js';
export type { NDJSONFrame, WireTraceContext } from './trace-context.js';
// B3 — W3C Trace Context serde + NDJSON frame envelope
export {
  parseTraceContext,
  serializeTraceContext,
  unwrapFrame,
  wrapFrame,
} from './trace-context.js';

import {
  err,
  ok,
  type PipelineContext,
  type Process,
  type ProcessError,
  proc,
  type Result,
  type RetryPolicy,
} from '@idriszade/core';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { withExtractSpan } from './otel.js';
import type { ProviderCallParams, ProviderResponse } from './providers/types.js';

export interface ExtractProcessConfig<I, O> {
  id?: string;
  provider: 'openai' | 'anthropic' | 'gemini';
  model: string;
  prompt: string | ((input: I) => string);
  inputSchema?: ZodType<I>;
  outputSchema: ZodType<O>;
  apiKey?: string;
  temperature?: number;
  maxRetriesOnSchemaFailure?: number;
  systemPrompt?: string;
  retryPolicy?: Partial<RetryPolicy>;
}

export type ExtractError = ProcessError;

function resolveApiKey(provider: string, configKey: string | undefined): string | undefined {
  if (configKey) return configKey;
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'gemini':
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    default:
      return undefined;
  }
}

function mapProviderError(e: unknown, provider: string): ProcessError {
  if (!(e instanceof Error)) {
    return {
      type: 'unknown',
      code: 'unknown_error',
      message: String(e),
    };
  }

  const msg = e.message;
  const status = (e as { status?: number }).status;
  const code = (e as { code?: string }).code;

  // Content filter (OpenAI null content)
  if (code === 'content_filter') {
    return { type: 'permanent', code: 'content_filtered', message: msg };
  }

  // Provider not installed
  if (
    msg.includes('Cannot find module') ||
    msg.includes('Module not found') ||
    msg.includes('ERR_MODULE_NOT_FOUND') ||
    msg.includes('Failed to resolve') ||
    msg.includes('Could not resolve')
  ) {
    const sdkMap: Record<string, string> = {
      openai: 'openai',
      anthropic: '@anthropic-ai/sdk',
      gemini: '@google/generative-ai',
    };
    const sdk = sdkMap[provider] ?? provider;
    return {
      type: 'permanent',
      code: 'provider_not_installed',
      message: `Install the SDK: npm i ${sdk}`,
      doc_url: '/docs/install-providers.md',
    };
  }

  // Rate limit
  if (status === 429 || msg.includes('rate') || msg.includes('429') || msg.includes('quota')) {
    const retryAfterMatch = /retry.after[:\s]+(\d+)/i.exec(msg);
    const retry_after_ms =
      retryAfterMatch !== null && retryAfterMatch[1] !== undefined
        ? parseInt(retryAfterMatch[1], 10) * 1000
        : undefined;
    return {
      type: 'transient',
      code: 'rate_limited',
      message: msg,
      ...(retry_after_ms !== undefined ? { metadata: { retry_after_ms } } : {}),
    };
  }

  // Auth failure
  if (
    status === 401 ||
    msg.includes('auth') ||
    msg.includes('API key') ||
    msg.includes('Unauthorized')
  ) {
    return {
      type: 'permanent',
      code: 'auth_failed',
      message: msg,
    };
  }

  // Network / timeout
  if (
    msg.includes('network') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout')
  ) {
    return {
      type: 'transient',
      code: 'network_error',
      message: msg,
    };
  }

  // Default fallback: 4xx → permanent, everything else → unknown
  if (status !== undefined && status >= 400 && status < 500) {
    return { type: 'permanent', code: 'provider_error', message: msg };
  }
  return { type: 'unknown', code: 'provider_unknown', message: msg };
}

async function callProvider(
  provider: 'openai' | 'anthropic' | 'gemini',
  params: ProviderCallParams,
): Promise<ProviderResponse> {
  switch (provider) {
    case 'openai': {
      const { callOpenAI } = await import('./providers/openai.js');
      return callOpenAI(params);
    }
    case 'anthropic': {
      const { callAnthropic } = await import('./providers/anthropic.js');
      return callAnthropic(params);
    }
    case 'gemini': {
      const { callGemini } = await import('./providers/gemini.js');
      return callGemini(params);
    }
  }
}

export function createExtractProcess<I, O>(config: ExtractProcessConfig<I, O>): Process<I, O> {
  const resolvedId = config.id ?? proc();
  const maxRetries = config.maxRetriesOnSchemaFailure ?? 2;

  async function run(input: I, _ctx: PipelineContext): Promise<Result<O, ProcessError>> {
    const promptStr = typeof config.prompt === 'function' ? config.prompt(input) : config.prompt;

    // zod-to-json-schema is pinned to Zod v3 types; cast through unknown to satisfy its ZodSchema<any> param
    const jsonSchemaRaw = zodToJsonSchema(config.outputSchema as never, { $refStrategy: 'none' });
    const jsonSchema = jsonSchemaRaw as Record<string, unknown>;

    const apiKey = resolveApiKey(config.provider, config.apiKey);

    const baseParams: ProviderCallParams = {
      model: config.model,
      apiKey,
      systemPrompt: config.systemPrompt,
      promptStr,
      jsonSchema,
      temperature: config.temperature,
    };

    let lastParseError = '';
    let lastIssues: unknown[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let providerResponse: ProviderResponse;

      const callParams: ProviderCallParams =
        attempt === 0
          ? baseParams
          : {
              ...baseParams,
              promptStr: `${baseParams.promptStr}\n\nYour last response failed schema validation: ${lastParseError}. Output valid JSON matching: ${JSON.stringify(jsonSchema)}`,
            };

      try {
        providerResponse = await withExtractSpan(
          config.provider,
          config.model,
          async (setUsage) => {
            const resp = await callProvider(config.provider, callParams);
            setUsage(resp.inputTokens, resp.outputTokens, resp.finishReasons);
            return resp;
          },
        );
      } catch (e) {
        return err(mapProviderError(e, config.provider));
      }

      const parsed = config.outputSchema.safeParse(providerResponse.rawJson);
      if (parsed.success) {
        return ok(parsed.data);
      }

      lastParseError = parsed.error.message;
      lastIssues = parsed.error.issues;
    }

    return err({
      type: 'validation',
      code: 'schema_parse_exhausted',
      message: `Schema validation failed after ${maxRetries + 1} attempts: ${lastParseError}`,
      metadata: { issues: lastIssues },
    });
  }

  return {
    id: resolvedId,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    retryPolicy: config.retryPolicy,
    run,
  };
}

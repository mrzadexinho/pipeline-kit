import type { ProviderCallParams, ProviderResponse } from './types.js';

export async function callOpenAI(params: ProviderCallParams): Promise<ProviderResponse> {
  const { default: OpenAI } = (await import('openai')) as {
    default: new (opts: {
      apiKey?: string;
    }) => {
      chat: {
        completions: {
          create: (opts: unknown) => Promise<{
            choices: Array<{
              message: { content: string | null };
              finish_reason: string | null;
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
          }>;
        };
      };
    };
  };

  const client = new OpenAI({ apiKey: params.apiKey });

  const messages: Array<{ role: string; content: string }> = [];
  if (params.systemPrompt) {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  messages.push({ role: 'user', content: params.promptStr });

  const response = await client.chat.completions.create({
    model: params.model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'extraction', strict: true, schema: params.jsonSchema },
    },
    temperature: params.temperature,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    const reason = response.choices[0]?.finish_reason ?? 'unknown';
    throw Object.assign(new Error(`OpenAI returned no content (finish_reason: ${reason})`), {
      code: 'content_filter',
      status: 400,
    });
  }
  const rawJson = JSON.parse(content) as unknown;
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const finishReasons = response.choices.map((c) => c.finish_reason ?? 'unknown');

  return { rawJson, inputTokens, outputTokens, finishReasons };
}

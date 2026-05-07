import type { ProviderCallParams, ProviderResponse } from './types.js';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export async function callAnthropic(params: ProviderCallParams): Promise<ProviderResponse> {
  const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as {
    default: new (opts: {
      apiKey?: string;
    }) => {
      messages: {
        create: (opts: unknown) => Promise<{
          content: ContentBlock[];
          stop_reason: string | null;
          usage: { input_tokens: number; output_tokens: number };
        }>;
      };
    };
  };

  const client = new Anthropic({ apiKey: params.apiKey });

  const response = await client.messages.create({
    model: params.model,
    max_tokens: 4096,
    system: params.systemPrompt,
    messages: [{ role: 'user', content: params.promptStr }],
    tools: [
      {
        name: 'extract',
        description: 'Extract structured data',
        input_schema: params.jsonSchema as unknown as {
          type: 'object';
          properties?: Record<string, unknown>;
          required?: string[];
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract' },
  });

  const toolUse = response.content.find(
    (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
  );
  const rawJson = toolUse?.input ?? {};
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const finishReasons = [response.stop_reason ?? 'unknown'];

  return { rawJson, inputTokens, outputTokens, finishReasons };
}

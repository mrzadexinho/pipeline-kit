import type { ProviderCallParams, ProviderResponse } from './types.js';

export async function callGemini(params: ProviderCallParams): Promise<ProviderResponse> {
  const { GoogleGenerativeAI } = (await import('@google/generative-ai')) as {
    GoogleGenerativeAI: new (
      apiKey: string,
    ) => {
      getGenerativeModel: (opts: unknown) => {
        generateContent: (prompt: string) => Promise<{
          response: {
            text: () => string;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            candidates?: Array<{ finishReason?: unknown }>;
          };
        }>;
      };
    };
  };

  const genai = new GoogleGenerativeAI(params.apiKey ?? '');
  const modelInstance = genai.getGenerativeModel({
    model: params.model,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: params.jsonSchema as unknown,
      temperature: params.temperature,
    },
    systemInstruction: params.systemPrompt,
  });

  const result = await modelInstance.generateContent(params.promptStr);
  const rawJson = JSON.parse(result.response.text()) as unknown;
  const inputTokens = result.response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0;
  const finishReasons = result.response.candidates?.map((c) =>
    String(c.finishReason ?? 'unknown'),
  ) ?? ['unknown'];

  return { rawJson, inputTokens, outputTokens, finishReasons };
}

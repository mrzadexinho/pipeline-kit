export interface ProviderResponse {
  rawJson: unknown;
  inputTokens: number;
  outputTokens: number;
  finishReasons: string[];
}

export interface ProviderCallParams {
  model: string;
  apiKey: string | undefined;
  systemPrompt: string | undefined;
  promptStr: string;
  jsonSchema: Record<string, unknown>;
  temperature: number | undefined;
}

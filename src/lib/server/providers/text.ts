import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output } from 'ai';
import type { StructuredRequest, StructuredTextProvider } from './contracts';

export class AiSdkStructuredProvider implements StructuredTextProvider {
  readonly id: string;
  readonly model: string;
  private readonly provider;
  private readonly reasoningEffort?: string;
  private readonly providerOptionsKey: string;

  constructor(options: { id: string; baseURL: string; apiKey: string; model: string; reasoningEffort?: string }) {
    this.id = options.id;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.providerOptionsKey = options.id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    this.provider = createOpenAICompatible({
      name: options.id,
      baseURL: options.baseURL,
      apiKey: options.apiKey || 'local',
      supportsStructuredOutputs: true
    });
  }

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const { output } = await generateText({
      model: this.provider(this.model),
      output: Output.object({
        name: request.schemaName,
        schema: request.schema
      }),
      system: `${request.system}\nReturn only the requested structured result. Do not include reasoning or markdown.`,
      prompt: request.prompt,
      temperature: 0.2,
      maxOutputTokens: 32_768,
      providerOptions: this.reasoningEffort
        ? { [this.providerOptionsKey]: { reasoningEffort: this.reasoningEffort } }
        : undefined
    });
    return request.schema.parse(output);
  }
}

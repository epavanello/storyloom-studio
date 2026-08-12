import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type { StructuredRequest, StructuredTextProvider } from './contracts';

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

export class AiSdkStructuredProvider implements StructuredTextProvider {
  readonly id: string;
  readonly model: string;
  private readonly provider;

  constructor(options: { id: string; baseURL: string; apiKey: string; model: string }) {
    this.id = options.id;
    this.model = options.model;
    this.provider = createOpenAICompatible({ name: options.id, baseURL: options.baseURL, apiKey: options.apiKey || 'local' });
  }

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await generateText({
      model: this.provider(this.model),
      system: `${request.system}\nReturn only valid JSON matching the requested structure.`,
      prompt: request.prompt,
      temperature: 0.2
    });
    return request.schema.parse(extractJson(response.text));
  }
}


import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output } from 'ai';
import { z } from 'zod';
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

/** Compresses a provider error into something that still fits on one progress line. */
function describeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /^(\d{3}) ([^:]+)/.exec(message);
  if (status) return `HTTP ${status[1]} ${status[2].trim()}`;
  return message.length > 60 ? `${message.slice(0, 60)}…` : message;
}

export class OpenRouterStructuredProvider implements StructuredTextProvider {
  readonly id = 'openrouter';

  constructor(readonly model: string, private readonly apiKey: string) {}

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const timeoutMs = request.timeoutMs ?? 90_000;
    const maxAttempts = request.providerAttempts ?? 3;
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: `${request.system}\nReturn only the requested structured result. Do not include reasoning or markdown. Every required property must be present; use an empty array when no items are found.` },
      { role: 'user', content: request.prompt }
    ];
    let lastError: unknown;
    // Why the previous attempt was abandoned, phrased for the progress line. Empty on the
    // first attempt, which is exactly when no retry counter should be shown at all.
    let retryReason = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeoutLabel = timeoutMs >= 120_000 ? `${Math.round(timeoutMs / 60_000)} min` : `${Math.round(timeoutMs / 1_000)}s`;
      await request.onStatus?.(retryReason
        ? `Asking the model again · retry ${attempt - 1} of ${maxAttempts - 1} · ${retryReason}`
        : `Waiting for the model to answer · up to ${timeoutLabel}`);
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: this.model,
            messages,
            response_format: {
              type: 'json_schema',
              json_schema: { name: request.schemaName, strict: true, schema: z.toJSONSchema(request.schema) }
            },
            reasoning: { enabled: false },
            temperature: attempt === 1 ? 0.2 : 0,
            max_tokens: 16_384
          })
        });
        const errorText = response.ok ? '' : (await response.text()).slice(0, 500);
        if (!response.ok) {
          const providerError = new Error(`${response.status} ${response.statusText}: ${errorText}`);
          if (response.status < 500 && response.status !== 408 && response.status !== 429) throw providerError;
          throw providerError;
        }
        const payload = await response.json() as { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) throw new Error(payload.error?.message ?? 'OpenRouter returned no structured content');
        try {
          return request.schema.parse(JSON.parse(content));
        } catch (error) {
          lastError = error;
          if (attempt === maxAttempts) break;
          retryReason = 'the last answer was missing required fields';
          await request.onStatus?.('The model answered in the wrong shape · asking it to correct the missing fields');
          const issues = error instanceof z.ZodError ? error.issues : [{ message: error instanceof Error ? error.message : 'Invalid JSON' }];
          messages.push(
            { role: 'assistant', content },
            { role: 'user', content: `The result violates the required schema. Correct it and return the complete JSON object. Validation issues:\n${JSON.stringify(issues)}` }
          );
        }
      } catch (error) {
        lastError = error;
        const fatalClientError = error instanceof Error && /^4\d\d /.test(error.message) && !/^(408|429) /.test(error.message);
        if (fatalClientError) throw error;
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || /timed? ?out|aborted/i.test(error.message));
        const failure = timedOut ? `no answer within ${timeoutLabel}` : `the call failed (${describeFailure(error)})`;
        retryReason = timedOut ? `the last call ran past ${timeoutLabel}` : `the last call failed (${describeFailure(error)})`;
        if (attempt < maxAttempts) {
          const retryDelayMs = attempt * 2_000;
          await request.onStatus?.(`${failure} · retrying in ${retryDelayMs / 1_000}s`);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    throw new Error(`OpenRouter could not produce ${request.schemaName} after ${maxAttempts} ${maxAttempts === 1 ? 'attempt' : 'attempts'}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

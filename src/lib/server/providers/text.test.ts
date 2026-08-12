import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenRouterStructuredProvider } from './text';

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter structured output', () => {
  it('asks the model to correct a schema-invalid response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{}' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"characters":[]}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OpenRouterStructuredProvider('deepseek/test', 'test-key').generate({
      schemaName: 'character-patch',
      schema: z.object({ characters: z.array(z.string()) }),
      system: 'Extract characters.',
      prompt: 'Chapter text'
    });

    expect(result).toEqual({ characters: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.messages.at(-1).content).toContain('Validation issues');
  });
});

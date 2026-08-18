import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ProviderStatus } from './contracts';
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

  it('routes by throughput and only to providers honouring the strict schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"characters":[]}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await new OpenRouterStructuredProvider('deepseek/test', 'test-key').generate({
      schemaName: 'character-patch',
      schema: z.object({ characters: z.array(z.string()) }),
      system: 'Extract characters.',
      prompt: 'Chapter text'
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ sort: 'throughput', require_parameters: true });
  });

  it('reports plain progress without a stopwatch or a false completion percentage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"characters":[]}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const statuses: ProviderStatus[] = [];

    await new OpenRouterStructuredProvider('deepseek/test', 'test-key').generate({
      schemaName: 'character-patch',
      schema: z.object({ characters: z.array(z.string()) }),
      system: 'Extract characters.',
      prompt: 'Chapter text',
      timeoutMs: 300_000,
      onStatus: async (status) => { statuses.push(status); }
    });

    expect(statuses).toEqual([{ detail: 'Working on it', progress: 0 }]);
  });

  it('explains a retry in words a reader can act on, and restarts its bar', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"characters":' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"characters":[]}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const statuses: ProviderStatus[] = [];

    await new OpenRouterStructuredProvider('deepseek/test', 'test-key').generate({
      schemaName: 'character-patch',
      schema: z.object({ characters: z.array(z.string()) }),
      system: 'Extract characters.',
      prompt: 'Chapter text',
      onStatus: async (status) => { statuses.push(status); }
    });

    expect(statuses).toEqual([
      { detail: 'Working on it', progress: 0 },
      { detail: 'Attempt 2 of 3 · the last answer stopped halfway', progress: 0 }
    ]);
  });

  it('keeps the default routing but still demands schema support when sorting is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"characters":[]}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await new OpenRouterStructuredProvider('deepseek/test', 'test-key', '').generate({
      schemaName: 'character-patch',
      schema: z.object({ characters: z.array(z.string()) }),
      system: 'Extract characters.',
      prompt: 'Chapter text'
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({ require_parameters: true });
  });

  it('explains a routing dead end instead of reporting a bare 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"No allowed providers are available for the selected model."}}', { status: 404, statusText: 'Not Found' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const attempt = new OpenRouterStructuredProvider('deepseek/test', 'test-key').generate({
      schemaName: 'character-patch',
      schema: z.object({ characters: z.array(z.string()) }),
      system: 'Extract characters.',
      prompt: 'Chapter text'
    });

    await expect(attempt).rejects.toThrow(/OPENROUTER_PROVIDER_SORT/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

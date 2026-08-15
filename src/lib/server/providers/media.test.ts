import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store', () => ({
  safePart: (value: string) => value,
  resolveArtifact: vi.fn(),
  saveArtifact: vi.fn(async (_bookId: string, path: string, _data: Uint8Array, meta: Record<string, unknown>) => ({
    path: `/api/artifacts/book/${path}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...meta
  }))
}));

import { saveArtifact } from '../store';
import { ChatterboxSpeechProvider, OpenAiCompatibleImageProvider, OpenAiCompatibleSpeechProvider, OpenRouterSpeechProvider } from './media';
import type { ImageRequest } from './contracts';

describe('OpenRouter speech adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the persisted actor voice directly and records the generation ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-123' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterSpeechProvider('qwen/qwen3-tts-flash', 'test-key', ['Kore', 'Puck']);
    const artifact = await provider.synthesize({
      bookId: 'book', artifactName: 'line', text: 'Buongiorno.', emotion: 'calm', intensity: 0.4, pace: 'natural',
      voice: { characterId: 'anna', voiceId: 'Kore', seed: 42, description: 'firm female voice', gender: 'female', language: 'it', provider: 'openrouter', model: provider.model }
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ voice: 'Kore', seed: 42, input: 'Buongiorno.', response_format: 'mp3' });
    expect(artifact).toMatchObject({ voiceId: 'Kore', generationId: 'gen-123', mimeType: 'audio/mpeg' });
  });

  it('asks Gemini for PCM and stores it as a playable WAV', async () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(pcm, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenRouterSpeechProvider('google/gemini-3.1-flash-tts-preview', 'test-key', ['Kore']);
    const artifact = await provider.synthesize({
      bookId: 'book', artifactName: 'line', text: 'Buongiorno.', emotion: 'calm', intensity: 0.4, pace: 'natural',
      voice: { characterId: 'anna', voiceId: 'Kore', seed: 42, description: 'firm female voice', gender: 'female', language: 'it', provider: 'openrouter', model: provider.model }
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toBe('pcm');
    expect(artifact).toMatchObject({ mimeType: 'audio/wav', path: '/api/artifacts/book/audio/line.wav' });
    const saved = Buffer.from(vi.mocked(saveArtifact).mock.calls.at(-1)![2]);
    expect(saved.subarray(0, 4).toString()).toBe('RIFF');
    expect(saved.readUInt32LE(24)).toBe(24_000);
    expect(saved.byteLength).toBe(44 + pcm.byteLength);
  });
});

describe('Local Qwen speech adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the server language and instruct fields instead of auto-detection and an ignored instructions field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAiCompatibleSpeechProvider('local-tts', 'tts-1-it', 'http://127.0.0.1:7861/v1', '', 'wav');
    await provider.synthesize({
      bookId: 'book', artifactName: 'line', text: 'Buongiorno.', emotion: 'calm', intensity: 0.4, pace: 'natural',
      voice: { characterId: 'narrator', voiceId: 'Serena', seed: 42, description: 'warm narrator', gender: 'female', language: 'it', provider: 'local-tts', model: provider.model }
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ language: 'Italian', voice: 'Serena', input: 'Buongiorno.' });
    expect(body.instruct).toBe('Leggi esclusivamente in italiano naturale come narratore letterario sobrio, con ritmo naturale. Riproduci esattamente il testo senza aggiunte o commenti.');
    expect(body).not.toHaveProperty('instructions');
    expect(body).not.toHaveProperty('seed');
  });
});

describe('Local Chatterbox V3 adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses an Italian reference identity and restrained controls for neutral narration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new ChatterboxSpeechProvider('http://127.0.0.1:7861/v1');
    await provider.synthesize({
      bookId: 'book', artifactName: 'line', text: 'Uscita dall’ospedale.', emotion: 'neutral', intensity: 1, pace: 'slow',
      voice: { characterId: 'narrator', voiceId: 'narrator-female', seed: 42, description: 'warm narrator', gender: 'female', language: 'it', provider: provider.id, model: provider.model }
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ language: 'it', voice: 'narrator-female', exaggeration: 0.4, cfg_weight: 0.35, temperature: 0.65 });
  });
});

describe('Local image adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests native 16:9 scenes and square identity references', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from([1, 2, 3]).toString('base64') }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAiCompatibleImageProvider('local-image', 'flux2-klein', 'http://127.0.0.1:7862/v1', '');
    const baseRequest: Omit<ImageRequest, 'kind'> = {
      bookId: 'book', artifactName: 'image', prompt: 'A cinematic scene.', characters: [], worldElements: [], seed: 42, styleId: 'illustrated-v1'
    };

    await provider.generate({ ...baseRequest, kind: 'scene' });
    await provider.generate({ ...baseRequest, kind: 'character-reference' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).size).toBe('1024x576');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).size).toBe('1024x1024');
  });
});

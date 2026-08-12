import { readFile } from 'node:fs/promises';
import { saveArtifact, safePart } from '../store';
import type { ArtifactRef } from '$lib/core/schemas';
import type { ImageProvider, ImageRequest, SpeechProvider, SpeechRequest } from './contracts';

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function fetchChecked(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

export class OpenAiCompatibleSpeechProvider implements SpeechProvider {
  constructor(readonly id: string, readonly model: string, private readonly baseUrl: string, private readonly apiKey: string) {}

  async synthesize(request: SpeechRequest): Promise<ArtifactRef> {
    const response = await fetchChecked(`${this.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({
        model: this.model,
        input: request.text,
        voice: request.voice.voiceId,
        response_format: 'mp3',
        seed: request.voice.seed,
        instructions: `Speak in ${request.emotion} emotion, intensity ${request.intensity}, at a ${request.pace} pace.`
      })
    });
    return saveArtifact(request.bookId, `audio/${safePart(request.artifactName)}.mp3`, new Uint8Array(await response.arrayBuffer()), { mimeType: 'audio/mpeg', provider: this.id, model: this.model });
  }
}

export class OpenAiCompatibleImageProvider implements ImageProvider {
  supportsMultipleReferences = true;
  constructor(readonly id: string, readonly model: string, private readonly baseUrl: string, private readonly apiKey: string) {}

  async generate(request: ImageRequest): Promise<ArtifactRef> {
    const references = await Promise.all(request.characters.flatMap((character) => character.referenceImages.slice(0, 2)).map(async (reference) => {
      const match = reference.path.match(/^\/api\/artifacts\/([^/]+)\/(.+)$/);
      if (!match) return reference.path;
      try {
        const bytes = await readFile(new URL(`../../../../../data/books/${decodeURIComponent(match[1])}/artifacts/${decodeURIComponent(match[2])}`, import.meta.url));
        return `data:${reference.mimeType};base64,${bytes.toString('base64')}`;
      } catch {
        return reference.path;
      }
    }));
    const response = await fetchChecked(`${this.baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({ model: this.model, prompt: request.prompt, size: '1536x1024', seed: request.seed, reference_images: references })
    });
    const payload = await response.json() as { data?: { b64_json?: string; url?: string }[] };
    const result = payload.data?.[0];
    if (!result) throw new Error('Image provider returned no image');
    const bytes = result.b64_json
      ? Uint8Array.from(Buffer.from(result.b64_json, 'base64'))
      : new Uint8Array(await (await fetchChecked(result.url!, {})).arrayBuffer());
    return saveArtifact(request.bookId, `${request.kind === 'scene' ? 'scenes' : 'characters'}/${safePart(request.artifactName)}.png`, bytes, { mimeType: 'image/png', provider: this.id, model: this.model });
  }
}

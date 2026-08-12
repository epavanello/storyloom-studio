import { readFile } from 'node:fs/promises';
import { resolveArtifact, saveArtifact, safePart } from '../store';
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
  constructor(
    readonly id: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly responseFormat: 'wav' | 'mp3' = 'mp3'
  ) {}

  async synthesize(request: SpeechRequest): Promise<ArtifactRef> {
    const response = await fetchChecked(`${this.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({
        model: this.model,
        input: request.text,
        voice: request.voice.voiceId,
        response_format: this.responseFormat,
        seed: request.voice.seed,
        instructions: `Speak in ${request.emotion} emotion, intensity ${request.intensity}, at a ${request.pace} pace.`
      })
    });
    return saveArtifact(
      request.bookId,
      `audio/${safePart(request.artifactName)}.${this.responseFormat}`,
      new Uint8Array(await response.arrayBuffer()),
      { mimeType: this.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg', provider: this.id, model: this.model }
    );
  }
}

export class OpenRouterSpeechProvider implements SpeechProvider {
  readonly id = 'openrouter';

  constructor(readonly model: string, private readonly apiKey: string, private readonly voices: string[]) {}

  async synthesize(request: SpeechRequest): Promise<ArtifactRef> {
    const voice = this.voices[Math.abs(request.voice.seed) % this.voices.length];
    const response = await fetchChecked('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({ model: this.model, input: request.text, voice, response_format: 'mp3' })
    });
    return saveArtifact(
      request.bookId,
      `audio/${safePart(request.artifactName)}.mp3`,
      new Uint8Array(await response.arrayBuffer()),
      { mimeType: 'audio/mpeg', provider: this.id, model: this.model }
    );
  }
}

export class OpenAiCompatibleImageProvider implements ImageProvider {
  supportsMultipleReferences = true;
  constructor(readonly id: string, readonly model: string, private readonly baseUrl: string, private readonly apiKey: string) {}

  async generate(request: ImageRequest): Promise<ArtifactRef> {
    const references = await Promise.all(request.characters.flatMap((character) => character.referenceImages.slice(0, 2)).slice(0, 4).map(async (reference) => {
      const match = reference.path.match(/^\/api\/artifacts\/([^/]+)\/(.+)$/);
      if (!match) return null;
      try {
        const relativePath = match[2].split('/').map(decodeURIComponent).join('/');
        return {
          bytes: await readFile(resolveArtifact(decodeURIComponent(match[1]), relativePath)),
          mimeType: reference.mimeType
        };
      } catch {
        return null;
      }
    })).then((items) => items.filter((item): item is NonNullable<typeof item> => item !== null));
    const root = this.baseUrl.replace(/\/$/, '');
    const response = references.length
      ? await (() => {
          const form = new FormData();
          form.set('model', this.model);
          form.set('prompt', request.prompt);
          form.set('size', '1024x1024');
          form.set('seed', String(request.seed));
          form.set('steps', '4');
          form.set('guidance_scale', '1');
          for (const [index, reference] of references.entries()) {
            form.append('image', new Blob([reference.bytes], { type: reference.mimeType }), `reference-${index}.png`);
          }
          return fetchChecked(`${root}/images/edits`, { method: 'POST', headers: authHeaders(this.apiKey), body: form });
        })()
      : await fetchChecked(`${root}/images/generations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
          body: JSON.stringify({ model: this.model, prompt: request.prompt, size: '1024x1024', seed: request.seed, steps: 4, guidance_scale: 1 })
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

export class OpenRouterImageProvider implements ImageProvider {
  readonly id = 'openrouter';
  readonly supportsMultipleReferences = true;

  constructor(readonly model: string, private readonly apiKey: string) {}

  async generate(request: ImageRequest): Promise<ArtifactRef> {
    const inputReferences = await Promise.all(request.characters.flatMap((character) => character.referenceImages.slice(0, 2)).map(async (reference) => {
      const match = reference.path.match(/^\/api\/artifacts\/([^/]+)\/(.+)$/);
      if (!match) return null;
      try {
        const relativePath = match[2].split('/').map(decodeURIComponent).join('/');
        const bytes = await readFile(resolveArtifact(decodeURIComponent(match[1]), relativePath));
        return { type: 'image_url', image_url: { url: `data:${reference.mimeType};base64,${bytes.toString('base64')}` } };
      } catch {
        return null;
      }
    })).then((items) => items.filter((item): item is NonNullable<typeof item> => item !== null));
    const response = await fetchChecked('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({
        model: this.model,
        prompt: request.prompt,
        aspect_ratio: request.kind === 'scene' ? '16:9' : '1:1',
        resolution: '1K',
        ...(inputReferences.length ? { input_references: inputReferences } : {})
      })
    });
    const payload = await response.json() as { data?: { b64_json?: string; url?: string; media_type?: string }[] };
    const result = payload.data?.[0];
    if (!result) throw new Error('OpenRouter returned no image');
    const bytes = result.b64_json
      ? Uint8Array.from(Buffer.from(result.b64_json, 'base64'))
      : new Uint8Array(await (await fetchChecked(result.url!, {})).arrayBuffer());
    const mimeType = result.media_type ?? 'image/png';
    const extension = mimeType === 'image/svg+xml' ? 'svg' : mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    return saveArtifact(request.bookId, `${request.kind === 'scene' ? 'scenes' : 'characters'}/${safePart(request.artifactName)}.${extension}`, bytes, { mimeType, provider: this.id, model: this.model });
  }
}

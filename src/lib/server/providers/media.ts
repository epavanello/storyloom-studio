import { readArtifact, saveArtifact, safePart } from '../store';
import type { ArtifactRef } from '../../core/schemas';
import { chatterboxVoiceOptions, geminiVoiceOptions, qwenVoiceOptions } from '../voices';
import type { ImageProvider, ImageRequest, SpeechProvider, SpeechRequest, VoiceOption } from './contracts';

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function fetchChecked(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

function qwenInstruction(request: SpeechRequest) {
  const emotion = /^(neutral|calm)$/iu.test(request.emotion) ? '' : ` con emozione ${request.emotion}`;
  const role = request.voice.characterId === 'narrator' ? 'narratore letterario sobrio' : 'personaggio credibile';
  const pace = request.pace === 'slow' ? 'lento' : request.pace === 'fast' ? 'sostenuto' : 'naturale';
  return `Leggi esclusivamente in italiano naturale come ${role}${emotion}, con ritmo ${pace}. Riproduci esattamente il testo senza aggiunte o commenti.`;
}

/**
 * Gemini TTS on OpenRouter only emits headerless 24 kHz mono 16-bit PCM, so we prepend the
 * RIFF header ourselves to hand the client a file it can actually play.
 */
function wavFromPcm(pcm: Uint8Array, sampleRate = 24_000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.byteLength, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, pcm]));
}

/**
 * Loads the approved reference sheets for the identities actually present in a scene.
 * A reference that cannot be read is dropped rather than silently substituted, so the
 * caller still knows which identities the result was conditioned on.
 */
async function loadReferences(request: ImageRequest, limit = Number.POSITIVE_INFINITY) {
  const refs = [
    ...request.characters.flatMap((character) => character.referenceImages.slice(0, 2)),
    ...request.worldElements.flatMap((element) => element.referenceImages.slice(0, 1))
  ].slice(0, limit);
  const loaded = await Promise.all(refs.map(async (reference) => {
    try {
      return { bytes: await readArtifact(reference), mimeType: reference.mimeType };
    } catch {
      return null;
    }
  }));
  return loaded.filter((item): item is NonNullable<typeof item> => item !== null);
}

export class OpenAiCompatibleSpeechProvider implements SpeechProvider {
  readonly voiceOptions = qwenVoiceOptions;
  constructor(
    readonly id: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly responseFormat: 'wav' | 'mp3' = 'mp3'
  ) {}

  async synthesize(request: SpeechRequest): Promise<ArtifactRef> {
    const language = request.voice.language === 'it' ? 'Italian' : request.voice.language;
    const instructions = qwenInstruction(request);
    const response = await fetchChecked(`${this.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({
        model: this.model,
        input: request.text,
        voice: request.voice.voiceId,
        response_format: this.responseFormat,
        language,
        instruct: instructions
      })
    });
    return saveArtifact(
      request.bookId,
      `audio/${safePart(request.artifactName)}.${this.responseFormat}`,
      new Uint8Array(await response.arrayBuffer()),
      {
        mimeType: this.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg', provider: this.id, model: this.model,
        voiceId: request.voice.voiceId,
        language,
        instructions,
        generationId: response.headers.get('x-generation-id') ?? undefined
      }
    );
  }
}

export class ChatterboxSpeechProvider implements SpeechProvider {
  readonly id = 'local-chatterbox';
  readonly model = 'chatterbox-multilingual-v3';
  readonly voiceOptions = chatterboxVoiceOptions;

  constructor(private readonly baseUrl: string) {}

  async synthesize(request: SpeechRequest): Promise<ArtifactRef> {
    const expressive = !/^(neutral|calm)$/iu.test(request.emotion);
    const exaggeration = expressive ? Math.min(0.7, 0.42 + request.intensity * 0.25) : 0.4;
    const cfgWeight = request.pace === 'slow' ? 0.35 : request.pace === 'fast' ? 0.5 : 0.45;
    const controls = `Italian · reference ${request.voice.voiceId} · emotion ${request.emotion} · exaggeration ${exaggeration.toFixed(2)} · cfg ${cfgWeight.toFixed(2)} · temperature 0.65`;
    const response = await fetchChecked(`${this.baseUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: request.text,
        voice: request.voice.voiceId,
        language: 'it',
        response_format: 'wav',
        seed: request.voice.seed,
        exaggeration,
        cfg_weight: cfgWeight,
        temperature: 0.65
      })
    });
    return saveArtifact(
      request.bookId,
      `audio/${safePart(request.artifactName)}.wav`,
      new Uint8Array(await response.arrayBuffer()),
      {
        mimeType: 'audio/wav', provider: this.id, model: this.model,
        voiceId: request.voice.voiceId, language: 'Italian', instructions: controls,
        generationId: response.headers.get('x-generation-id') ?? undefined
      }
    );
  }
}

export class OpenRouterSpeechProvider implements SpeechProvider {
  readonly id = 'openrouter';
  readonly voiceOptions: readonly VoiceOption[];
  /** Gemini rejects every response_format except raw PCM; other OpenRouter TTS models return mp3. */
  private readonly isGemini: boolean;

  constructor(readonly model: string, private readonly apiKey: string, voices: string[]) {
    this.isGemini = model.startsWith('google/gemini-');
    const catalog = this.isGemini ? geminiVoiceOptions : qwenVoiceOptions;
    this.voiceOptions = voices.map((id) => catalog.find((voice) => voice.id === id) ?? { id, gender: 'unknown' as const, description: 'provider voice' });
  }

  async synthesize(request: SpeechRequest): Promise<ArtifactRef> {
    const response = await fetchChecked('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
      body: JSON.stringify({
        model: this.model,
        input: request.text,
        voice: request.voice.voiceId,
        seed: request.voice.seed,
        response_format: this.isGemini ? 'pcm' : 'mp3'
      })
    });
    const payload = new Uint8Array(await response.arrayBuffer());
    return saveArtifact(
      request.bookId,
      `audio/${safePart(request.artifactName)}.${this.isGemini ? 'wav' : 'mp3'}`,
      this.isGemini ? wavFromPcm(payload) : payload,
      {
        mimeType: this.isGemini ? 'audio/wav' : 'audio/mpeg', provider: this.id, model: this.model,
        voiceId: request.voice.voiceId,
        generationId: response.headers.get('x-generation-id') ?? undefined
      }
    );
  }
}

export class OpenAiCompatibleImageProvider implements ImageProvider {
  supportsMultipleReferences = true;
  constructor(readonly id: string, readonly model: string, private readonly baseUrl: string, private readonly apiKey: string) {}

  async generate(request: ImageRequest): Promise<ArtifactRef> {
    const references = await loadReferences(request, 4);
    const root = this.baseUrl.replace(/\/$/, '');
    const size = request.kind === 'scene' ? '1024x576' : '1024x1024';
    const response = references.length
      ? await (() => {
          const form = new FormData();
          form.set('model', this.model);
          form.set('prompt', request.prompt);
          form.set('size', size);
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
          body: JSON.stringify({ model: this.model, prompt: request.prompt, size, seed: request.seed, steps: 4, guidance_scale: 1 })
        });
    const payload = await response.json() as { data?: { b64_json?: string; url?: string }[] };
    const result = payload.data?.[0];
    if (!result) throw new Error('Image provider returned no image');
    const bytes = result.b64_json
      ? Uint8Array.from(Buffer.from(result.b64_json, 'base64'))
      : new Uint8Array(await (await fetchChecked(result.url!, {})).arrayBuffer());
    const directory = request.kind === 'scene' ? 'scenes' : request.kind === 'world-reference' ? 'world' : 'characters';
    return saveArtifact(request.bookId, `${directory}/${safePart(request.artifactName)}.png`, bytes, { mimeType: 'image/png', provider: this.id, model: this.model, styleId: request.styleId });
  }
}

export class OpenRouterImageProvider implements ImageProvider {
  readonly id = 'openrouter';
  readonly supportsMultipleReferences = true;

  constructor(readonly model: string, private readonly apiKey: string) {}

  async generate(request: ImageRequest): Promise<ArtifactRef> {
    const inputReferences = (await loadReferences(request)).map((reference) => ({
      type: 'image_url',
      image_url: { url: `data:${reference.mimeType};base64,${Buffer.from(reference.bytes).toString('base64')}` }
    }));
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchChecked('https://openrouter.ai/api/v1/images', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(this.apiKey) },
          signal: AbortSignal.timeout(120_000),
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
        if (!result) throw new Error('OpenRouter returned no image data');
        const bytes = result.b64_json
          ? Uint8Array.from(Buffer.from(result.b64_json, 'base64'))
          : new Uint8Array(await (await fetchChecked(result.url!, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
        const mimeType = result.media_type ?? 'image/png';
        const extension = mimeType === 'image/svg+xml' ? 'svg' : mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
        const directory = request.kind === 'scene' ? 'scenes' : request.kind === 'world-reference' ? 'world' : 'characters';
        return saveArtifact(request.bookId, `${directory}/${safePart(request.artifactName)}.${extension}`, bytes, { mimeType, provider: this.id, model: this.model, styleId: request.styleId });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable = /IMAGE_OTHER|no image data|^(408|429|5\d\d)\b|timeout|aborted/iu.test(message);
        if (!retryable || attempt === 3) throw error;
      }
    }
    throw new Error(`OpenRouter image generation failed after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

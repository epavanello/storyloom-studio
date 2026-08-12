import { z } from 'zod';
import type { ChapterPlan, Character } from '$lib/core/schemas';
import { ChapterPlanSchema } from '$lib/core/schemas';
import { saveArtifact, safePart } from '../store';
import type { AlignmentProvider, ImageProvider, ImageRequest, SpeechProvider, SpeechRequest, StructuredRequest, StructuredTextProvider } from './contracts';

function hash(input: string) {
  let result = 2166136261;
  for (const char of input) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function xml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
}

export class MockStructuredProvider implements StructuredTextProvider {
  id = 'mock';
  model = 'deterministic-demo';

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    if (request.schemaName === 'character-patch') {
      const names = [...request.prompt.matchAll(/\b([A-ZÀ-Ý][a-zà-ÿ]{2,}(?:\s+[A-ZÀ-Ý][a-zà-ÿ]{2,})?)\b/g)]
        .map((match) => match[1])
        .filter((name) => !/^(The|Chapter|Capitolo|Quando|Mentre|Dopo|Prima|Nel|Nella|Una|Un|Il|La)$/i.test(name));
      const unique = [...new Set(names)].slice(0, 6);
      const chapterId = request.prompt.match(/CHAPTER_ID:\s*([^\n]+)/)?.[1] ?? 'chapter-1';
      return request.schema.parse({ characters: unique.map((name) => ({
        id: safePart(name), canonicalName: name, aliases: [],
        physicalDescription: `Distinctive illustrated appearance for ${name}, inferred conservatively from the text`,
        personality: 'To be refined as the story reveals more details', narrativeRole: 'Character',
        firstAppearanceChapterId: chapterId, referenceImages: []
      })) });
    }
    if (request.schemaName === 'chapter-plan') {
      const chapterId = request.prompt.match(/CHAPTER_ID:\s*([^\n]+)/)?.[1] ?? 'chapter-1';
      const text = request.prompt.split('CHAPTER_TEXT:\n')[1]?.split('\n\nCHARACTER_REGISTRY:')[0] ?? '';
      return request.schema.parse(mockPlan(chapterId, text));
    }
    throw new Error(`Mock provider does not implement ${request.schemaName}`);
  }
}

function mockPlan(chapterId: string, text: string): ChapterPlan {
  const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const selected = chunks.slice(0, 28);
  let cursor = 0;
  const utterances = selected.map((part, order) => {
    const start = Math.max(cursor, text.indexOf(part, cursor));
    cursor = start + part.length;
    const quote = /^[«“\"]/.test(part) || /[»”\"]/.test(part);
    return {
      id: `u-${order + 1}`, order, text: part, textStart: start, textEnd: cursor,
      speakerCharacterId: null,
      direction: { emotion: quote ? 'engaged' : order % 5 === 0 ? 'intrigue' : 'narrative', intensity: quote ? 0.62 : 0.4, pace: 'natural' as const, pauseAfterMs: quote ? 450 : 280 }
    };
  });
  const visuals = utterances.filter((_, index) => index === 0 || index % 4 === 0).map((utterance, index) => ({
    id: `v-${index + 1}`, utteranceId: utterance.id,
    prompt: `Cinematic editorial illustration of this story beat: ${utterance.text}`,
    characterIds: [], shot: index % 2 ? 'medium shot' : 'wide establishing shot', mood: utterance.direction.emotion
  }));
  return ChapterPlanSchema.parse({ schemaVersion: 1, chapterId, synopsis: selected.slice(0, 3).join(' '), cast: [], utterances, visuals, sounds: [] });
}

export class MockImageProvider implements ImageProvider {
  id = 'mock';
  model = 'procedural-svg';
  supportsMultipleReferences = true;

  async generate(request: ImageRequest) {
    const hue = hash(request.prompt) % 360;
    const title = request.kind === 'character-reference' ? request.characters[0]?.canonicalName ?? 'Character' : request.prompt.slice(0, 72);
    const subtitle = request.kind === 'character-reference' ? 'Character reference · locked identity' : request.characters.map((character) => character.canonicalName).join(' · ') || 'Story beat';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 55% 24%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 64% 8%)"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .08 0"/></filter></defs><rect width="1200" height="750" fill="url(#g)"/><rect width="1200" height="750" filter="url(#n)" opacity=".35"/><circle cx="910" cy="285" r="175" fill="hsl(${(hue + 22) % 360} 75% 68% / .2)"/><path d="M760 670c32-185 94-280 177-280 86 0 155 96 185 280" fill="hsl(${hue} 25% 96% / .15)"/><text x="76" y="535" fill="#fff" font-family="Georgia,serif" font-size="54" font-weight="600">${xml(title)}</text><text x="80" y="590" fill="#fff" opacity=".65" font-family="Arial,sans-serif" font-size="20" letter-spacing="2">${xml(subtitle.toUpperCase())}</text></svg>`;
    return saveArtifact(request.bookId, `${request.kind === 'scene' ? 'scenes' : 'characters'}/${safePart(request.artifactName)}.svg`, svg, { mimeType: 'image/svg+xml', provider: this.id, model: this.model });
  }
}

function silentWav(durationSeconds: number) {
  const sampleRate = 16_000;
  const samples = Math.max(1, Math.round(durationSeconds * sampleRate));
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

export class MockSpeechProvider implements SpeechProvider {
  id = 'mock'; model = 'timed-silence';
  async synthesize(request: SpeechRequest) {
    const duration = Math.max(1.2, request.text.split(/\s+/).length / 2.45 + 0.4);
    return saveArtifact(request.bookId, `audio/${safePart(request.artifactName)}.wav`, silentWav(duration), { mimeType: 'audio/wav', provider: this.id, model: this.model });
  }
}

export class ProportionalAligner implements AlignmentProvider {
  id = 'proportional';
  async align(_audioPath: string, text: string, durationMs: number) {
    const words = text.match(/\S+/g) ?? [];
    const weights = words.map((word) => Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, '').length));
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    let elapsed = 0;
    return {
      words: words.map((word, index) => {
        const startMs = elapsed;
        elapsed += (weights[index] / total) * durationMs;
        return { text: word, startMs, endMs: index === words.length - 1 ? durationMs : elapsed };
      }),
      quality: 'approximate' as const
    };
  }
}


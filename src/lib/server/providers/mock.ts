import { z } from 'zod';
import type { ArtifactRef, ChapterPlan, Character } from '../../core/schemas';
import { ChapterPlanSchema } from '../../core/schemas';
import { saveArtifact, safePart } from '../store';
import { visualBeatRange } from '../../core/plan';
import { imageDirectory, type AlignmentProvider, type ImageProvider, type ImageRequest, type SpeechProvider, type SpeechRequest, type StructuredRequest, type StructuredTextProvider } from './contracts';

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
  model = 'deterministic-demo-v2';

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    if (request.schemaName === 'story-outline') {
      const input = jsonMarker<{ prompt: string; chapterCount: number }>(request.prompt, 'STORY_REQUEST_JSON');
      const subject = input.prompt.replace(/\s+/g, ' ').trim();
      return request.schema.parse({
        title: mockStoryTitle(subject),
        premise: subject,
        language: 'same language as the request',
        styleGuide: 'Clear, atmospheric prose with stable names, chronological continuity, and a conclusive final chapter.',
        chapters: Array.from({ length: input.chapterCount }, (_, order) => ({
          order,
          title: `Chapter ${order + 1}`,
          synopsis: order === input.chapterCount - 1
            ? `The central conflict from “${subject.slice(0, 120)}” reaches a complete resolution.`
            : `The consequences of “${subject.slice(0, 120)}” deepen and lead directly into the next chapter.`,
          continuityNotes: order === 0 ? 'Introduce the protagonist, setting, and central desire.' : 'Preserve every established identity and consequence from the preceding chapter.'
        }))
      });
    }
    if (request.schemaName === 'story-chapter') {
      const specification = jsonMarker<{ order: number; title: string; synopsis: string }>(request.prompt, 'CURRENT_CHAPTER_JSON');
      const storyRequest = request.prompt.split('STORY_REQUEST:\n')[1]?.split('\n\nCOMPLETE_OUTLINE_JSON:')[0]?.trim() ?? 'an original adventure';
      return request.schema.parse({ title: specification.title, text: mockStoryText(storyRequest, specification) });
    }
    if (request.schemaName === 'character-patch' || request.schemaName === 'registry-patch') {
      const chapterId = request.prompt.match(/CHAPTER_ID:\s*([^\n]+)/)?.[1] ?? 'chapter-1';
      const text = chapterText(request.prompt);
      const names = mockCharacterNames(text);
      return request.schema.parse({ characters: names.map((name) => ({
        id: safePart(name), canonicalName: name, aliases: [],
        physicalDescription: 'Physical appearance is not established in the demo excerpt',
        personality: 'Not established in the demo excerpt', narrativeRole: 'Story character',
        voiceGender: 'unknown', voiceDescription: 'Neutral demo delivery',
        firstAppearanceChapterId: chapterId, referenceImages: []
      })), worldElements: [] });
    }
    if (request.schemaName === 'cover-concept') {
      const title = request.prompt.match(/BOOK_TITLE:\s*([^\n]+)/)?.[1] ?? 'the story';
      return request.schema.parse({
        concept: `A single symbolic object at the heart of “${title}”, isolated against open space`,
        composition: 'Centred subject, generous negative space above it, low horizon',
        palette: 'Cold blues and bone white with one warm amber accent'
      });
    }
    if (request.schemaName === 'chapter-plan') {
      const chapterId = request.prompt.match(/CHAPTER_ID:\s*([^\n]+)/)?.[1] ?? 'chapter-1';
      const text = chapterText(request.prompt);
      return request.schema.parse(mockPlan(chapterId, text, characterRegistry(request.prompt)));
    }
    throw new Error(`Mock provider does not implement ${request.schemaName}`);
  }
}

function jsonMarker<T>(prompt: string, marker: string): T {
  const serialized = prompt.split(`${marker}:\n`)[1]?.split('\n\n')[0];
  if (!serialized) throw new Error(`Mock prompt is missing ${marker}`);
  return JSON.parse(serialized) as T;
}

function mockStoryTitle(prompt: string) {
  const compact = prompt.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim();
  return compact.split(/\s+/).slice(0, 7).join(' ') || 'An Untitled Story';
}

function mockStoryText(request: string, chapter: { order: number; synopsis: string }) {
  const premise = request.replace(/\s+/g, ' ').trim().slice(0, 260);
  const beats = [
    'The morning began with a small choice whose weight was not yet visible. The familiar world seemed unchanged, but every ordinary detail pointed toward a question that could no longer be ignored.',
    'The protagonist moved carefully through the setting, noticing what had shifted since the last decision. A remembered promise supplied direction while the consequences of earlier actions remained tangible.',
    'An unexpected encounter complicated the route forward. Neither side could obtain everything they wanted, so the conversation ended with a precise compromise and a new reason to keep moving.',
    'Distance made the goal appear simpler than it was. Up close, the obstacle revealed a human cost, and the protagonist paused long enough to understand that courage would require attention rather than speed.',
    'A concrete clue connected the present moment to the central mystery. Its meaning did not arrive as an explanation; it emerged through action, memory, and the careful comparison of two details already established.',
    'Pressure narrowed the available choices. The protagonist acted, accepted the immediate consequence, and protected the one relationship that mattered most to the chapter’s emotional movement.',
    'Silence followed. In that interval, the setting carried the change: light, sound, and physical distance made clear that there could be no return to the chapter’s opening state.',
    'The final exchange resolved the local conflict without erasing its cost. What had been learned became a decision, and that decision aligned the characters with the next necessary step.',
    'Before leaving, the protagonist looked back once and recognized the shape of the transformation. The goal remained specific, the continuity remained intact, and the story advanced rather than resetting.',
    'The chapter closed on a completed action and a clear consequence. Nothing was summarized for the reader; the meaning rested in what the characters had chosen and what the world now required of them.'
  ];
  const paragraphs = beats.map((beat, index) => `${beat} This movement develops the requested premise — ${premise} — through scene ${chapter.order + 1}.${index + 1}, while preserving names, motives, and causal continuity. ${chapter.synopsis}`);
  return paragraphs.join('\n\n');
}

function chapterText(prompt: string) {
  return prompt.split('CHAPTER_TEXT:\n')[1]?.split('\n\nCHARACTER_REGISTRY:')[0] ?? '';
}

function characterRegistry(prompt: string): Character[] {
  const serialized = prompt.split('\n\nCHARACTER_REGISTRY:\n')[1]?.split('\n\nWORLD_REGISTRY:')[0];
  if (!serialized) return [];
  try {
    const value = JSON.parse(serialized);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const ignoredNames = new Set([
  'A', 'An', 'At', 'After', 'Above', 'Before', 'Book', 'Capitolo', 'Chapter', 'Come', 'Dopo', 'He', 'Her', 'His', 'I',
  'Il', 'In', 'It', 'La', 'Le', 'Libro', 'Midnight', 'Mentre', 'Nel', 'Nella', 'Not', 'Parte', 'Part', 'Prima',
  'She', 'The', 'They', 'This', 'Una', 'Un', 'Via', 'We', 'What', 'When', 'Where', 'Who', 'You'
]);

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mockCharacterNames(text: string) {
  const candidates = [...text.matchAll(/\b\p{Lu}\p{Ll}{2,}\b/gu)].map((match) => match[0]);
  const counts = new Map<string, number>();
  for (const name of candidates) counts.set(name, (counts.get(name) ?? 0) + 1);

  return [...counts]
    .filter(([name, count]) => {
      if (ignoredNames.has(name)) return false;
      if (count >= 2) return true;
      const token = escaped(name);
      return new RegExp(`\\b(?:name|named|called|nome|chiamat[oa])\\s+${token}\\b`, 'iu').test(text)
        || new RegExp(`\\b${token}\\s+(?:said|asked|whispered|replied|answered|disse|chiese|sussurrò|rispose)\\b`, 'iu').test(text);
    })
    .map(([name]) => name);
}

function sentenceSlices(text: string) {
  const slices: { text: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/[.!?]/.test(text[index])) continue;
    let end = index + 1;
    while (end < text.length && /[»”\"']/.test(text[end])) end += 1;
    if (end < text.length && !/\s/.test(text[end])) continue;
    const raw = text.slice(cursor, end);
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    if (raw.trim()) slices.push({ text: raw.slice(leading, raw.length - trailing), start: cursor + leading, end: end - trailing });
    cursor = end;
  }
  const raw = text.slice(cursor);
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  if (raw.trim()) slices.push({ text: raw.slice(leading, raw.length - trailing), start: cursor + leading, end: text.length - trailing });
  return slices;
}

function characterIdsInText(text: string, registry: Character[]) {
  return registry
    .filter((character) => [character.canonicalName, ...character.aliases].some((name) => new RegExp(`\\b${escaped(name)}\\b`, 'iu').test(text)))
    .map((character) => character.id);
}

function explicitSpeaker(text: string, registry: Character[]) {
  if (!/^[«“\"]/.test(text)) return null;
  return registry.find((character) => [character.canonicalName, ...character.aliases].some((name) =>
    new RegExp(`\\b${escaped(name)}\\s+(?:said|asked|whispered|replied|answered|disse|chiese|sussurrò|rispose)\\b`, 'iu').test(text)
  ))?.id ?? null;
}

function mockPlan(chapterId: string, text: string, registry: Character[]): ChapterPlan {
  const chunks = sentenceSlices(text);
  const utterances = chunks.map((part, order) => {
    const quote = /^[«“\"]/.test(part.text) || /[»”\"]/.test(part.text);
    return {
      id: `u-${order + 1}`, order, text: part.text, textStart: part.start, textEnd: part.end,
      speakerCharacterId: explicitSpeaker(part.text, registry),
      direction: { emotion: quote ? 'engaged' : order % 5 === 0 ? 'intrigue' : 'narrative', intensity: quote ? 0.62 : 0.4, pace: 'natural' as const, pauseAfterMs: quote ? 450 : 280 }
    };
  });
  const { minimum } = visualBeatRange(text);
  const visualIndexes = Array.from({ length: Math.min(minimum, utterances.length) }, (_, index) =>
    Math.round(index * Math.max(0, utterances.length - 1) / Math.max(1, Math.min(minimum, utterances.length) - 1))
  );
  const visuals = visualIndexes.map((utteranceIndex, index) => {
    const utterance = utterances[utteranceIndex];
    return ({
    id: `v-${index + 1}`, utteranceId: utterance.id,
    prompt: `Cinematic editorial illustration of this story beat: ${utterance.text}`,
    characterIds: characterIdsInText(utterance.text, registry), worldElementIds: [], shot: index % 2 ? 'medium shot' : 'wide establishing shot', mood: utterance.direction.emotion
    });
  });
  return ChapterPlanSchema.parse({
    schemaVersion: 1,
    chapterId,
    synopsis: utterances.slice(0, 3).map((utterance) => utterance.text).join(' '),
    cast: characterIdsInText(text, registry),
    utterances,
    visuals,
    sounds: []
  });
}

export class MockImageProvider implements ImageProvider {
  id = 'mock';
  model = 'procedural-svg-v2';
  supportsMultipleReferences = true;

  async generate(request: ImageRequest) {
    const hue = hash(request.prompt) % 360;
    // A cover carries no lettering even in the demo provider, because that is the one
    // property of a cover the pipeline promises.
    if (request.kind === 'cover') {
      const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="hsl(${hue} 58% 30%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 70% 7%)"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .07 0"/></filter></defs><rect width="800" height="1200" fill="url(#g)"/><rect width="800" height="1200" filter="url(#n)" opacity=".4"/><circle cx="400" cy="430" r="210" fill="hsl(${(hue + 30) % 360} 80% 70% / .22)"/><path d="M120 1200c60-330 150-500 280-500s220 170 280 500z" fill="hsl(${hue} 30% 96% / .16)"/></svg>`;
      return saveArtifact(request.bookId, `${imageDirectory(request.kind)}/${safePart(request.artifactName)}.svg`, cover, { mimeType: 'image/svg+xml', provider: this.id, model: this.model, styleId: request.styleId });
    }
    const title = request.kind === 'character-reference' ? request.characters[0]?.canonicalName ?? 'Character' : 'Generated scene preview';
    const subtitle = request.kind === 'character-reference' ? 'Character reference · locked identity' : request.characters.map((character) => character.canonicalName).join(' · ') || 'Story beat';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 55% 24%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 64% 8%)"/></linearGradient><filter id="n"><feTurbulence baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .08 0"/></filter></defs><rect width="1200" height="750" fill="url(#g)"/><rect width="1200" height="750" filter="url(#n)" opacity=".35"/><circle cx="910" cy="285" r="175" fill="hsl(${(hue + 22) % 360} 75% 68% / .2)"/><path d="M760 670c32-185 94-280 177-280 86 0 155 96 185 280" fill="hsl(${hue} 25% 96% / .15)"/><text x="76" y="535" fill="#fff" font-family="Georgia,serif" font-size="54" font-weight="600">${xml(title)}</text><text x="80" y="590" fill="#fff" opacity=".65" font-family="Arial,sans-serif" font-size="20" letter-spacing="2">${xml(subtitle.toUpperCase())}</text></svg>`;
    return saveArtifact(request.bookId, `${imageDirectory(request.kind)}/${safePart(request.artifactName)}.svg`, svg, { mimeType: 'image/svg+xml', provider: this.id, model: this.model, styleId: request.styleId });
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
  voiceOptions = [
    { id: 'demo-female', gender: 'female' as const, description: 'demo female voice' },
    { id: 'demo-male', gender: 'male' as const, description: 'demo male voice' },
    { id: 'demo-neutral', gender: 'neutral' as const, description: 'demo neutral voice' }
  ];
  async synthesize(request: SpeechRequest) {
    const duration = Math.max(1.2, request.text.split(/\s+/).length / 2.45 + 0.4);
    return saveArtifact(request.bookId, `audio/${safePart(request.artifactName)}.wav`, silentWav(duration), { mimeType: 'audio/wav', provider: this.id, model: this.model, voiceId: request.voice.voiceId });
  }
}

export class ProportionalAligner implements AlignmentProvider {
  id = 'proportional';
  async align(_audio: ArtifactRef, text: string, durationMs: number) {
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

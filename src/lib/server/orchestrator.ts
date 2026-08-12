import { randomUUID } from 'node:crypto';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import { BookManifestSchema, ChapterPlanSchema, CharacterSchema, type BookManifest, type Character, type RenderedChapter, type VoiceProfile } from '$lib/core/schemas';
import { locateChapterPlanText, validateChapterPlan } from '$lib/core/plan';
import { parseBook } from './ingest';
import { bookDir, getManifest, getRenderedChapter, saveManifest, saveRenderedChapter, safePart } from './store';
import { providers } from './providers/router';
import { withLocalRuntime } from './runtime';

const CharacterPatchSchema = z.object({ characters: z.array(CharacterSchema) });

function seed(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}

const qwenPresetVoices = ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'] as const;

function mergeCharacters(existing: Character[], incoming: Character[]) {
  const merged = [...existing];
  for (const candidate of incoming) {
    const aliases = new Set([candidate.canonicalName.toLowerCase(), ...candidate.aliases.map((alias) => alias.toLowerCase())]);
    const match = merged.find((character) => [character.canonicalName, ...character.aliases].some((name) => aliases.has(name.toLowerCase())));
    if (!match) merged.push(candidate);
    else {
      match.aliases = [...new Set([...match.aliases, ...candidate.aliases])];
      if (candidate.physicalDescription.length > match.physicalDescription.length) match.physicalDescription = candidate.physicalDescription;
      if (candidate.personality.length > match.personality.length) match.personality = candidate.personality;
    }
  }
  return merged;
}

function voiceFor(characterId: string | null, manifest: BookManifest): VoiceProfile {
  if (!characterId) return { characterId: 'narrator', voiceId: 'Serena', seed: seed(`${manifest.id}:narrator`), description: 'Warm, expressive literary narrator' };
  return manifest.voices.find((voice) => voice.characterId === characterId) ?? {
    characterId,
    voiceId: qwenPresetVoices[seed(`${manifest.id}:${characterId}`) % qwenPresetVoices.length],
    seed: seed(`${manifest.id}:${characterId}`),
    description: `Stable voice for ${characterId}`
  };
}

export async function ingestBook(fileName: string, bytes: Uint8Array) {
  const parsed = await parseBook(fileName, bytes);
  if (!parsed.chapters.length) throw new Error('No readable chapters were found');
  const id = `${safePart(parsed.title).slice(0, 38)}-${randomUUID().slice(0, 7)}`;
  const manifest = BookManifestSchema.parse({
    schemaVersion: 1, id, title: parsed.title, sourceName: fileName,
    createdAt: new Date().toISOString(), chapters: parsed.chapters, characters: [], voices: [], registryStatus: 'pending'
  });
  await saveManifest(manifest);
  return manifest;
}

export async function prepareRegistry(bookId: string) {
  const manifest = await getManifest(bookId);
  manifest.registryStatus = 'processing';
  await saveManifest(manifest);
  const service = providers();
  try {
    const registry = await withLocalRuntime('text', async () => {
      let current = manifest.characters;
      for (const chapter of manifest.chapters) {
        const patch = await service.text.generate({
          schema: CharacterPatchSchema,
          schemaName: 'character-patch',
          system: 'Extract story characters. Deduplicate against the supplied registry. Never invent physical traits not supported by the text.',
          prompt: `CHAPTER_ID: ${chapter.id}\nCURRENT_REGISTRY:\n${JSON.stringify(current)}\nCHAPTER_TEXT:\n${chapter.text}`
        });
        current = mergeCharacters(current, patch.characters.map((character) => ({ ...character, id: safePart(character.id || character.canonicalName) })));
      }
      return current;
    });
    const missingReferences = registry.filter((character) => !character.referenceImages.length);
    if (missingReferences.length) await withLocalRuntime('image-generate', async () => {
      for (const character of missingReferences) {
        const reference = await service.image.generate({
          bookId, artifactName: `${character.id}-reference`, kind: 'character-reference', characters: [character], seed: seed(`${bookId}:${character.id}`),
          prompt: `Character reference sheet, neutral background, front portrait and three-quarter view. ${character.canonicalName}. ${character.physicalDescription}. Personality: ${character.personality}. Preserve this identity in later scenes.`
        });
        character.referenceImages = [reference];
      }
    });
    manifest.characters = registry;
    manifest.voices = registry.map((character) => voiceFor(character.id, manifest));
    manifest.registryStatus = 'ready';
    await saveManifest(manifest);
    return manifest;
  } catch (error) {
    manifest.registryStatus = 'failed';
    await saveManifest(manifest);
    throw error;
  }
}

export async function prepareChapter(bookId: string, chapterId: string) {
  const cached = await getRenderedChapter(bookId, chapterId);
  if (cached) return cached;
  let manifest = await getManifest(bookId);
  if (manifest.registryStatus !== 'ready') manifest = await prepareRegistry(bookId);
  const chapter = manifest.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const service = providers();
  const generatedPlan = await withLocalRuntime('text', () => service.text.generate({
    schema: ChapterPlanSchema,
    schemaName: 'chapter-plan',
    system: `Create an audiobook performance plan from the complete chapter. Preserve every original word exactly across utterances and attribute dialogue only when certain. Choose sparse, meaningful visual beats. Use stable character IDs from the registry. Do not include sound effects unless narratively useful.`,
    prompt: `CHAPTER_ID: ${chapter.id}\nCHAPTER_TITLE: ${chapter.title}\nCHAPTER_TEXT:\n${chapter.text}\n\nCHARACTER_REGISTRY:\n${JSON.stringify(manifest.characters)}`
  }));
  const plan = validateChapterPlan(
    chapter.text,
    chapter.id,
    manifest.characters.map((character) => character.id),
    locateChapterPlanText(chapter.text, generatedPlan)
  );

  const audioUtterances: { utterance: typeof plan.utterances[number]; audio: Awaited<ReturnType<typeof service.speech.synthesize>>; durationMs: number }[] = [];
  await withLocalRuntime('speech', async () => {
    for (const utterance of plan.utterances) {
      const voice = voiceFor(utterance.speakerCharacterId, manifest);
      const audio = await service.speech.synthesize({
        bookId, artifactName: `${chapter.id}-${utterance.id}`, text: utterance.text, voice,
        emotion: utterance.direction.emotion, intensity: utterance.direction.intensity, pace: utterance.direction.pace
      });
      let durationMs = Math.max(800, utterance.text.split(/\s+/).length / 2.45 * 1000);
      try {
        const relative = decodeURIComponent(audio.path.split(`/api/artifacts/${encodeURIComponent(bookId)}/`)[1]);
        const metadata = await parseFile(`${bookDir(bookId)}/artifacts/${relative}`);
        if (metadata.format.duration) durationMs = metadata.format.duration * 1000;
      } catch { /* use estimate */ }
      audioUtterances.push({ utterance, audio, durationMs });
    }
  });

  const renderedUtterances: RenderedChapter['utterances'] = [];
  let timelineMs = 0;
  await withLocalRuntime('alignment', async () => {
    for (const item of audioUtterances) {
      const alignment = await service.aligner.align(item.audio.path, item.utterance.text, item.durationMs);
      renderedUtterances.push({ utterance: item.utterance, audio: item.audio, startMs: timelineMs, durationMs: item.durationMs, words: alignment.words, alignment: alignment.quality });
      timelineMs += item.durationMs + item.utterance.direction.pauseAfterMs;
    }
  });

  const visualJobs = plan.visuals.map((cue) => ({
    cue,
    characters: cue.characterIds.map((id) => manifest.characters.find((character) => character.id === id)).filter(Boolean) as Character[]
  }));
  const renderedVisuals: RenderedChapter['visuals'] = [];
  const generateVisuals = async (jobs: typeof visualJobs) => {
    for (const { cue, characters } of jobs) {
      const anchor = renderedUtterances.find((item) => item.utterance.id === cue.utteranceId) ?? renderedUtterances[0];
      const image = await service.image.generate({
        bookId, artifactName: `${chapter.id}-${cue.id}`, kind: 'scene', characters, seed: seed(`${bookId}:${chapter.id}:${cue.id}`),
        prompt: `${cue.prompt}\nShot: ${cue.shot}. Mood: ${cue.mood}. Characters: ${characters.map((character) => `${character.canonicalName}: ${character.physicalDescription}`).join('; ')}. Editorial cinematic storybook illustration, no text.`
      });
      renderedVisuals.push({ cue, image, startMs: anchor?.startMs ?? 0 });
    }
  };
  const plainVisuals = visualJobs.filter(({ characters }) => !characters.some((character) => character.referenceImages.length));
  const referenceVisuals = visualJobs.filter(({ characters }) => characters.some((character) => character.referenceImages.length));
  if (plainVisuals.length) await withLocalRuntime('image-generate', () => generateVisuals(plainVisuals));
  if (referenceVisuals.length) await withLocalRuntime('image-edit', () => generateVisuals(referenceVisuals));
  renderedVisuals.sort((a, b) => plan.visuals.indexOf(a.cue) - plan.visuals.indexOf(b.cue));
  const rendered = { schemaVersion: 1 as const, chapterId, plan, utterances: renderedUtterances, visuals: renderedVisuals, totalDurationMs: Math.max(1, timelineMs), createdAt: new Date().toISOString() };
  await saveRenderedChapter(bookId, rendered);
  return rendered;
}

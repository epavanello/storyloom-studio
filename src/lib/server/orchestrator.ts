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

export type ProgressUpdate = {
  stepId: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  completed?: number;
  total?: number;
  detail?: string;
};

export type ProgressReporter = (update: ProgressUpdate) => Promise<void>;
const noProgress: ProgressReporter = async () => {};

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

export async function prepareRegistry(bookId: string, onProgress: ProgressReporter = noProgress) {
  const manifest = await getManifest(bookId);
  manifest.registryStatus = 'processing';
  await saveManifest(manifest);
  const service = providers();
  try {
    await onProgress({ stepId: 'registry-analysis', status: 'running', completed: 0, total: manifest.chapters.length, detail: 'Reading the first chapter' });
    const registry = await withLocalRuntime('text', async () => {
      let current = manifest.characters;
      for (const [index, chapter] of manifest.chapters.entries()) {
        const patch = await service.text.generate({
          schema: CharacterPatchSchema,
          schemaName: 'character-patch',
          system: 'Extract story characters. Deduplicate against the supplied registry. Never invent physical traits not supported by the text.',
          prompt: `CHAPTER_ID: ${chapter.id}\nCURRENT_REGISTRY:\n${JSON.stringify(current)}\nCHAPTER_TEXT:\n${chapter.text}`
        });
        current = mergeCharacters(current, patch.characters.map((character) => ({ ...character, id: safePart(character.id || character.canonicalName) })));
        manifest.characters = current;
        await saveManifest(manifest);
        await onProgress({ stepId: 'registry-analysis', completed: index + 1, total: manifest.chapters.length, detail: `Read ${index + 1} of ${manifest.chapters.length} chapters` });
      }
      return current;
    });
    await onProgress({ stepId: 'registry-analysis', status: 'completed', completed: manifest.chapters.length, total: manifest.chapters.length });
    const missingReferences = registry.filter((character) => !character.referenceImages.length);
    await onProgress({ stepId: 'registry-references', status: missingReferences.length ? 'running' : 'completed', completed: 0, total: missingReferences.length, detail: missingReferences.length ? 'Generating the first identity sheet' : 'All identity sheets are cached' });
    if (missingReferences.length) await withLocalRuntime('image-generate', async () => {
      for (const [index, character] of missingReferences.entries()) {
        const reference = await service.image.generate({
          bookId, artifactName: `${character.id}-reference`, kind: 'character-reference', characters: [character], seed: seed(`${bookId}:${character.id}`),
          prompt: `Character reference sheet, neutral background, front portrait and three-quarter view. ${character.canonicalName}. ${character.physicalDescription}. Personality: ${character.personality}. Preserve this identity in later scenes.`
        });
        character.referenceImages = [reference];
        await onProgress({ stepId: 'registry-references', completed: index + 1, total: missingReferences.length, detail: `Generated ${index + 1} of ${missingReferences.length} identity sheets` });
      }
    });
    await onProgress({ stepId: 'registry-references', status: 'completed', completed: missingReferences.length, total: missingReferences.length });
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

export async function prepareChapter(bookId: string, chapterId: string, onProgress: ProgressReporter = noProgress) {
  const cached = await getRenderedChapter(bookId, chapterId);
  if (cached) return cached;
  let manifest = await getManifest(bookId);
  if (manifest.registryStatus !== 'ready') {
    await onProgress({ stepId: 'registry', status: 'running', completed: 0, total: 1, detail: 'Preparing character identities first' });
    const chapterCount = manifest.chapters.length;
    manifest = await prepareRegistry(bookId, async (update) => {
      const isReferences = update.stepId === 'registry-references';
      await onProgress({
        stepId: 'registry',
        status: update.status === 'failed' ? 'failed' : update.status === 'completed' && isReferences ? 'completed' : 'running',
        completed: (isReferences ? chapterCount : 0) + (update.completed ?? 0),
        total: chapterCount + (isReferences ? update.total ?? 0 : 1),
        detail: update.detail ?? (isReferences ? 'Generating character identity sheets' : 'Reading the book for characters')
      });
    });
  }
  await onProgress({ stepId: 'registry', status: 'completed', completed: 1, total: 1, detail: 'Character registry ready' });
  const chapter = manifest.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const service = providers();
  await onProgress({ stepId: 'plan', status: 'running', completed: 0, total: 1, detail: 'Directing the complete chapter' });
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
  await onProgress({ stepId: 'plan', status: 'completed', completed: 1, total: 1, detail: `${plan.utterances.length} passages and ${plan.visuals.length} visual beats planned` });

  const audioUtterances: { utterance: typeof plan.utterances[number]; audio: Awaited<ReturnType<typeof service.speech.synthesize>>; durationMs: number }[] = [];
  await onProgress({ stepId: 'speech', status: 'running', completed: 0, total: plan.utterances.length, detail: 'Generating the first passage' });
  await withLocalRuntime('speech', async () => {
    for (const [index, utterance] of plan.utterances.entries()) {
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
      await onProgress({ stepId: 'speech', completed: index + 1, total: plan.utterances.length, detail: `Generated ${index + 1} of ${plan.utterances.length} passages` });
    }
  });
  await onProgress({ stepId: 'speech', status: 'completed', completed: plan.utterances.length, total: plan.utterances.length });

  const renderedUtterances: RenderedChapter['utterances'] = [];
  let timelineMs = 0;
  await onProgress({ stepId: 'alignment', status: 'running', completed: 0, total: audioUtterances.length, detail: 'Synchronizing the first passage' });
  await withLocalRuntime('alignment', async () => {
    for (const [index, item] of audioUtterances.entries()) {
      const alignment = await service.aligner.align(item.audio.path, item.utterance.text, item.durationMs);
      renderedUtterances.push({ utterance: item.utterance, audio: item.audio, startMs: timelineMs, durationMs: item.durationMs, words: alignment.words, alignment: alignment.quality });
      timelineMs += item.durationMs + item.utterance.direction.pauseAfterMs;
      await onProgress({ stepId: 'alignment', completed: index + 1, total: audioUtterances.length, detail: `Synchronized ${index + 1} of ${audioUtterances.length} passages` });
    }
  });
  await onProgress({ stepId: 'alignment', status: 'completed', completed: audioUtterances.length, total: audioUtterances.length });

  const visualJobs = plan.visuals.map((cue) => ({
    cue,
    characters: cue.characterIds.map((id) => manifest.characters.find((character) => character.id === id)).filter(Boolean) as Character[]
  }));
  const renderedVisuals: RenderedChapter['visuals'] = [];
  let completedVisuals = 0;
  await onProgress({ stepId: 'visuals', status: 'running', completed: 0, total: visualJobs.length, detail: visualJobs.length ? 'Staging the first scene' : 'No visual beats requested' });
  const generateVisuals = async (jobs: typeof visualJobs) => {
    for (const { cue, characters } of jobs) {
      const anchor = renderedUtterances.find((item) => item.utterance.id === cue.utteranceId) ?? renderedUtterances[0];
      const image = await service.image.generate({
        bookId, artifactName: `${chapter.id}-${cue.id}`, kind: 'scene', characters, seed: seed(`${bookId}:${chapter.id}:${cue.id}`),
        prompt: `${cue.prompt}\nShot: ${cue.shot}. Mood: ${cue.mood}. Characters: ${characters.map((character) => `${character.canonicalName}: ${character.physicalDescription}`).join('; ')}. Editorial cinematic storybook illustration, no text.`
      });
      renderedVisuals.push({ cue, image, startMs: anchor?.startMs ?? 0 });
      completedVisuals += 1;
      await onProgress({ stepId: 'visuals', completed: completedVisuals, total: visualJobs.length, detail: `Generated ${completedVisuals} of ${visualJobs.length} scenes` });
    }
  };
  const plainVisuals = visualJobs.filter(({ characters }) => !characters.some((character) => character.referenceImages.length));
  const referenceVisuals = visualJobs.filter(({ characters }) => characters.some((character) => character.referenceImages.length));
  if (plainVisuals.length) await withLocalRuntime('image-generate', () => generateVisuals(plainVisuals));
  if (referenceVisuals.length) await withLocalRuntime('image-edit', () => generateVisuals(referenceVisuals));
  await onProgress({ stepId: 'visuals', status: 'completed', completed: visualJobs.length, total: visualJobs.length });
  renderedVisuals.sort((a, b) => plan.visuals.indexOf(a.cue) - plan.visuals.indexOf(b.cue));
  const rendered = { schemaVersion: 1 as const, chapterId, plan, utterances: renderedUtterances, visuals: renderedVisuals, totalDurationMs: Math.max(1, timelineMs), createdAt: new Date().toISOString() };
  await saveRenderedChapter(bookId, rendered);
  return rendered;
}

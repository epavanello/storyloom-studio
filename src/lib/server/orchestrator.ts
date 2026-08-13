import { randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import { z } from 'zod';
import { BookManifestSchema, ChapterPlanSchema, CharacterSchema, type BookManifest, type Character, type RenderedChapter, type VoiceProfile } from '../core/schemas';
import { locateChapterPlanText, validateChapterPlan } from '../core/plan';
import { describeMissingCredentials, type RunContext } from './context';
import { parseBook } from './ingest';
import { createBook, getManifest, getRenderedChapter, readArtifact, saveBookRegistry, saveRenderedChapter, safePart } from './store';
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

export async function ingestBook(userId: string, fileName: string, bytes: Uint8Array) {
  const parsed = await parseBook(fileName, bytes);
  if (!parsed.chapters.length) throw new Error('No readable chapters were found');
  const id = `${safePart(parsed.title).slice(0, 38)}-${randomUUID().slice(0, 7)}`;
  const manifest = BookManifestSchema.parse({
    schemaVersion: 1, id, title: parsed.title, sourceName: fileName,
    createdAt: new Date().toISOString(), chapters: parsed.chapters, characters: [], voices: [], registryStatus: 'pending'
  });
  await createBook(userId, manifest);
  return manifest;
}

export async function prepareRegistry(context: RunContext, onProgress: ProgressReporter = noProgress) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const { bookId } = context;
  const manifest = await getManifest(context.userId, bookId);
  manifest.registryStatus = 'processing';
  await saveBookRegistry(bookId, { registryStatus: 'processing' });
  const service = providers(context);
  try {
    await onProgress({ stepId: 'registry-analysis', status: 'running', completed: 0, total: manifest.chapters.length, detail: 'Reading the first chapter' });
    const registry = await withLocalRuntime('text', async () => {
      let current = manifest.characters;
      for (const [index, chapter] of manifest.chapters.entries()) {
        const patch = await service.text.generate({
          schema: CharacterPatchSchema,
          schemaName: 'character-patch',
          system: 'Extract story characters. Deduplicate against the supplied registry. Never invent physical traits not supported by the text.',
          prompt: `CHAPTER_ID: ${chapter.id}\nCURRENT_REGISTRY:\n${JSON.stringify(current)}\nCHAPTER_TEXT:\n${chapter.text}`,
          onStatus: (detail) => onProgress({ stepId: 'registry-analysis', detail: `${chapter.title} · ${detail}` })
        });
        current = mergeCharacters(current, patch.characters.map((character) => ({ ...character, id: safePart(character.id || character.canonicalName) })));
        manifest.characters = current;
        // Persisted after every chapter so an interrupted registry pass resumes from the
        // identities it already established instead of re-reading the whole book.
        await saveBookRegistry(bookId, { characters: current });
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
    await saveBookRegistry(bookId, { characters: manifest.characters, voices: manifest.voices, registryStatus: 'ready' });
    return manifest;
  } catch (error) {
    manifest.registryStatus = 'failed';
    await saveBookRegistry(bookId, { registryStatus: 'failed' });
    throw error;
  }
}

export async function prepareChapter(context: RunContext, chapterId: string, onProgress: ProgressReporter = noProgress) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const { bookId } = context;
  const cached = await getRenderedChapter(bookId, chapterId);
  if (cached) return cached;
  let manifest = await getManifest(context.userId, bookId);
  if (manifest.registryStatus !== 'ready') {
    await onProgress({ stepId: 'registry', status: 'running', completed: 0, total: 1, detail: 'Preparing character identities first' });
    const chapterCount = manifest.chapters.length;
    manifest = await prepareRegistry(context, async (update) => {
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
  const service = providers(context);
  await onProgress({ stepId: 'plan', status: 'running', completed: 0, total: 1, detail: 'Directing the complete chapter' });
  let plan: z.infer<typeof ChapterPlanSchema> | undefined;
  let rejectedPlan: z.infer<typeof ChapterPlanSchema> | undefined;
  let planError = '';
  await withLocalRuntime('text', async () => {
    for (let planAttempt = 1; planAttempt <= 3; planAttempt += 1) {
      await onProgress({ stepId: 'plan', status: 'running', detail: `Validating complete source coverage · plan attempt ${planAttempt} of 3` });
      const correction = rejectedPlan
        ? `\n\nPREVIOUS_PLAN_REJECTED:\n${JSON.stringify(rejectedPlan)}\n\nVALIDATION_ERROR:\n${planError}\nReturn a complete corrected plan. Do not patch only one utterance.`
        : '';
      const candidate = await service.text.generate({
        schema: ChapterPlanSchema,
        schemaName: 'chapter-plan',
        system: `Create an audiobook performance plan from the complete chapter. Preserve every original word exactly once across ordered utterances: no omissions, additions, summaries, overlaps, or reordered passages. Attribute dialogue only when certain. Choose sparse, meaningful visual beats. Use stable character IDs from the registry. Do not include sound effects unless narratively useful.`,
        prompt: `CHAPTER_ID: ${chapter.id}\nCHAPTER_TITLE: ${chapter.title}\nCHAPTER_TEXT:\n${chapter.text}\n\nCHARACTER_REGISTRY:\n${JSON.stringify(manifest.characters)}${correction}`,
        onStatus: (detail) => onProgress({ stepId: 'plan', status: 'running', detail: `${detail} · plan ${planAttempt} of 3` })
      });
      try {
        plan = validateChapterPlan(
          chapter.text,
          chapter.id,
          manifest.characters.map((character) => character.id),
          locateChapterPlanText(chapter.text, candidate)
        );
        return;
      } catch (error) {
        rejectedPlan = candidate;
        planError = error instanceof Error ? error.message : String(error);
        if (planAttempt === 3) throw error;
      }
    }
  });
  const finalPlan = plan;
  if (!finalPlan) throw new Error('Chapter planner did not produce a validated plan');
  await onProgress({ stepId: 'plan', status: 'completed', completed: 1, total: 1, detail: `${finalPlan.utterances.length} passages and ${finalPlan.visuals.length} visual beats planned` });

  const audioUtterances: { utterance: typeof finalPlan.utterances[number]; audio: Awaited<ReturnType<typeof service.speech.synthesize>>; durationMs: number }[] = [];
  await onProgress({ stepId: 'speech', status: 'running', completed: 0, total: finalPlan.utterances.length, detail: 'Generating the first passage' });
  await withLocalRuntime('speech', async () => {
    for (const [index, utterance] of finalPlan.utterances.entries()) {
      const voice = voiceFor(utterance.speakerCharacterId, manifest);
      const audio = await service.speech.synthesize({
        bookId, artifactName: `${chapter.id}-${utterance.id}`, text: utterance.text, voice,
        emotion: utterance.direction.emotion, intensity: utterance.direction.intensity, pace: utterance.direction.pace
      });
      // The real audio duration drives the timeline; the word-count estimate is only a
      // fallback for a container the metadata parser cannot read.
      let durationMs = Math.max(800, utterance.text.split(/\s+/).length / 2.45 * 1000);
      try {
        const metadata = await parseBuffer(await readArtifact(audio), { mimeType: audio.mimeType });
        if (metadata.format.duration) durationMs = metadata.format.duration * 1000;
      } catch { /* use estimate */ }
      audioUtterances.push({ utterance, audio, durationMs });
      await onProgress({ stepId: 'speech', completed: index + 1, total: finalPlan.utterances.length, detail: `Generated ${index + 1} of ${finalPlan.utterances.length} passages` });
    }
  });
  await onProgress({ stepId: 'speech', status: 'completed', completed: finalPlan.utterances.length, total: finalPlan.utterances.length });

  const renderedUtterances: RenderedChapter['utterances'] = [];
  let timelineMs = 0;
  await onProgress({ stepId: 'alignment', status: 'running', completed: 0, total: audioUtterances.length, detail: 'Synchronizing the first passage' });
  await withLocalRuntime('alignment', async () => {
    for (const [index, item] of audioUtterances.entries()) {
      const alignment = await service.aligner.align(item.audio, item.utterance.text, item.durationMs);
      renderedUtterances.push({ utterance: item.utterance, audio: item.audio, startMs: timelineMs, durationMs: item.durationMs, words: alignment.words, alignment: alignment.quality });
      timelineMs += item.durationMs + item.utterance.direction.pauseAfterMs;
      await onProgress({ stepId: 'alignment', completed: index + 1, total: audioUtterances.length, detail: `Synchronized ${index + 1} of ${audioUtterances.length} passages` });
    }
  });
  await onProgress({ stepId: 'alignment', status: 'completed', completed: audioUtterances.length, total: audioUtterances.length });

  const visualJobs = finalPlan.visuals.map((cue) => ({
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
  renderedVisuals.sort((a, b) => finalPlan.visuals.indexOf(a.cue) - finalPlan.visuals.indexOf(b.cue));
  const rendered = { schemaVersion: 1 as const, chapterId, plan: finalPlan, utterances: renderedUtterances, visuals: renderedVisuals, totalDurationMs: Math.max(1, timelineMs), createdAt: new Date().toISOString() };
  await saveRenderedChapter(bookId, rendered);
  return rendered;
}

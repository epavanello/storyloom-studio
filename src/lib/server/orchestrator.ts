import { createHash, randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import { z } from 'zod';
import { BookManifestSchema, ChapterPlanSchema, CharacterSchema, WorldElementSchema, type BookManifest, type ChapterPlan, type Character, type GenerationAudioPreview, type RenderedChapter, type WorldElement } from '../core/schemas';
import { locateChapterPlanText, splitAttributedNarration, validateChapterPlan, validateVisualBeatCoverage, visualBeatRange } from '../core/plan';
import { parseBook } from './ingest';
import { describeMissingCredentials, type RunContext } from './context';
import { createBook, getManifest, getRenderedChapter, readArtifact, saveBookRegistry, saveRenderedChapter, safePart } from './store';
import { providers } from './providers/router';
import { withLocalRuntime } from './runtime';
import { assignVoiceProfiles, voiceFor } from './voices';
import { clearChapterGenerationCheckpoint, getChapterGenerationCheckpoint, saveChapterGenerationCheckpoint } from './checkpoints';

const RegistryPatchSchema = z.object({
  characters: z.array(CharacterSchema),
  worldElements: z.array(WorldElementSchema).default([])
});

export type ProgressUpdate = {
  stepId: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  completed?: number;
  total?: number;
  detail?: string;
  audioPreview?: GenerationAudioPreview;
  chapterPlan?: ChapterPlan;
  alignedPreview?: RenderedChapter['utterances'][number];
  visualPreview?: RenderedChapter['visuals'][number];
};

export type ProgressReporter = (update: ProgressUpdate) => Promise<void>;
const noProgress: ProgressReporter = async () => {};

function seed(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}

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
      if (match.voiceGender === 'unknown' && candidate.voiceGender !== 'unknown') match.voiceGender = candidate.voiceGender;
      if (candidate.voiceDescription.length > match.voiceDescription.length) match.voiceDescription = candidate.voiceDescription;
    }
  }
  return merged;
}

function mergeWorldElements(existing: WorldElement[], incoming: WorldElement[]) {
  const merged = [...existing];
  for (const candidate of incoming) {
    const aliases = new Set([candidate.canonicalName.toLowerCase(), ...candidate.aliases.map((alias) => alias.toLowerCase())]);
    const match = merged.find((element) => element.kind === candidate.kind && [element.canonicalName, ...element.aliases].some((name) => aliases.has(name.toLowerCase())));
    if (!match) {
      if (merged.length < 8) merged.push(candidate);
      continue;
    }
    match.aliases = [...new Set([...match.aliases, ...candidate.aliases])];
    if (candidate.visualDescription.length > match.visualDescription.length) match.visualDescription = candidate.visualDescription;
    if (candidate.textualEvidence.length > match.textualEvidence.length) match.textualEvidence = candidate.textualEvidence;
    if (candidate.referencePriority === 'essential') match.referencePriority = 'essential';
    else if (candidate.referencePriority === 'useful' && match.referencePriority === 'none') match.referencePriority = 'useful';
  }
  return merged;
}

/** Keeps a rejection reason readable on a single progress line. */
function shorten(message: string, limit = 110) {
  const flat = message.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

type AudioUnit = {
  utterance: ChapterPlan['utterances'][number];
  voice: ReturnType<typeof voiceFor>;
  audio: GenerationAudioPreview['audio'];
  durationMs: number;
};

function speechCheckpointFingerprint(plan: ChapterPlan, manifest: BookManifest, speech: ReturnType<typeof providers>['speech']) {
  const passages = plan.utterances.map((utterance) => {
    const voice = voiceFor(utterance.speakerCharacterId, manifest);
    return {
      utterance,
      voice: {
        voiceId: voice.voiceId,
        seed: voice.seed,
        language: voice.language,
        provider: voice.provider,
        model: voice.model,
        referenceAudioPath: voice.referenceAudioPath
      }
    };
  });
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, provider: speech.id, model: speech.model, passages })).digest('hex');
}

async function generateOrResumeChapterAudio(options: {
  context: RunContext;
  chapterId: string;
  kind: 'chapter' | 'chapter-audio';
  generationId?: string;
  plan: ChapterPlan;
  manifest: BookManifest;
  speech: ReturnType<typeof providers>['speech'];
  artifactName: (utteranceId: string) => string;
  onProgress: ProgressReporter;
  action: 'Generated' | 'Regenerated';
}) {
  const { context, chapterId, kind, generationId, plan, manifest, speech, artifactName, onProgress, action } = options;
  const fingerprint = speechCheckpointFingerprint(plan, manifest, speech);
  const now = new Date().toISOString();
  const stored = generationId
    ? await getChapterGenerationCheckpoint(context.userId, generationId, context.bookId, chapterId)
    : null;
  const compatible = stored?.kind === kind && stored.fingerprint === fingerprint;
  const reusable = new Map<string, GenerationAudioPreview>();

  if (compatible) {
    for (const preview of stored.audioPreview) {
      if (!plan.utterances.some((item) => item.id === preview.utterance.id)) continue;
      try {
        await readArtifact(preview.audio);
        reusable.set(preview.utterance.id, preview);
      } catch {
        // The checkpoint is only reusable when its immutable artifact still exists.
      }
    }
  }

  const checkpointBase = generationId ? {
    schemaVersion: 1 as const,
    jobId: generationId,
    userId: context.userId,
    bookId: context.bookId,
    chapterId,
    kind,
    fingerprint,
    plan,
    createdAt: compatible ? stored.createdAt : now
  } : null;
  if (checkpointBase && !compatible) {
    await saveChapterGenerationCheckpoint({ ...checkpointBase, audioPreview: [], updatedAt: now });
  }

  const completed = new Map<string, AudioUnit>();
  let completedCount = 0;
  await onProgress({ stepId: 'speech', status: 'running', completed: 0, total: plan.utterances.length, detail: reusable.size ? `Found ${reusable.size} saved passages` : `${action === 'Generated' ? 'Generating' : 'Regenerating'} the first passage` });

  const processPassages = async () => {
    for (const utterance of plan.utterances) {
      const voice = voiceFor(utterance.speakerCharacterId, manifest);
      let preview = reusable.get(utterance.id);
      if (!preview) {
        const audio = await speech.synthesize({
          bookId: context.bookId,
          artifactName: artifactName(utterance.id),
          text: utterance.text,
          voice,
          emotion: utterance.direction.emotion,
          intensity: utterance.direction.intensity,
          pace: utterance.direction.pace
        });
        let durationMs = Math.max(800, utterance.text.split(/\s+/).length / 2.45 * 1000);
        try {
          const metadata = await parseBuffer(await readArtifact(audio), { mimeType: audio.mimeType });
          if (metadata.format.duration) durationMs = metadata.format.duration * 1000;
        } catch { /* retain the explicit approximate duration */ }
        preview = {
          utterance,
          audio,
          voice: { ...voice, voiceId: audio.voiceId ?? voice.voiceId, provider: audio.provider, model: audio.model },
          durationMs
        };
        reusable.set(utterance.id, preview);
        if (checkpointBase) {
          await saveChapterGenerationCheckpoint({
            ...checkpointBase,
            audioPreview: plan.utterances.map((item) => reusable.get(item.id)).filter(Boolean) as GenerationAudioPreview[],
            updatedAt: new Date().toISOString()
          });
        }
      }
      completed.set(utterance.id, { utterance, voice, audio: preview.audio, durationMs: preview.durationMs });
      completedCount += 1;
      const reused = compatible && stored.audioPreview.some((item) => item.utterance.id === utterance.id);
      await onProgress({
        stepId: 'speech',
        completed: completedCount,
        total: plan.utterances.length,
        detail: `${reused ? 'Reused' : action} ${completedCount} of ${plan.utterances.length} passages`,
        audioPreview: preview
      });
    }
  };

  if (reusable.size === plan.utterances.length) await processPassages();
  else await withLocalRuntime('speech', processPassages);
  await onProgress({ stepId: 'speech', status: 'completed', completed: plan.utterances.length, total: plan.utterances.length });
  return plan.utterances.map((utterance) => completed.get(utterance.id)!);
}

export async function ingestBook(userId: string, fileName: string, bytes: Uint8Array) {
  const parsed = await parseBook(fileName, bytes);
  if (!parsed.chapters.length) throw new Error('No readable chapters were found');
  const id = `${safePart(parsed.title).slice(0, 38)}-${randomUUID().slice(0, 7)}`;
  const manifest = BookManifestSchema.parse({
    schemaVersion: 1, id, title: parsed.title, sourceName: fileName,
    createdAt: new Date().toISOString(), chapters: parsed.chapters, characters: [], worldElements: [], voices: [], registryStatus: 'pending'
  });
  await createBook(userId, manifest);
  return manifest;
}

export async function prepareRegistry(context: RunContext, onProgress: ProgressReporter = noProgress) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const { bookId } = context;
  const manifest = await getManifest(context.userId, bookId);
  const registryAlreadyAnalyzed = manifest.registryStatus === 'ready' && (manifest.characters.length > 0 || manifest.worldElements.length > 0);
  manifest.registryStatus = 'processing';
  await saveBookRegistry(bookId, { registryStatus: 'processing' });
  const service = providers(context);
  try {
    await onProgress({
      stepId: 'registry-analysis', status: registryAlreadyAnalyzed ? 'completed' : 'running',
      completed: registryAlreadyAnalyzed ? manifest.chapters.length : 0, total: manifest.chapters.length,
      detail: registryAlreadyAnalyzed ? 'Existing continuity registries are current' : 'Reading the first chapter'
    });
    const registry = registryAlreadyAnalyzed ? { characters: manifest.characters, worldElements: manifest.worldElements } : await withLocalRuntime('text', async () => {
      let currentCharacters = manifest.characters;
      let currentWorldElements = manifest.worldElements;
      for (const [index, chapter] of manifest.chapters.entries()) {
        const patch = await service.text.generate({
          schema: RegistryPatchSchema,
          schemaName: 'registry-patch',
          system: `Update the story registries from textual evidence. Extract characters conservatively and deduplicate against the supplied registry. For every character, set voiceGender to female, male, or neutral only when supported by the text; otherwise use unknown. voiceDescription is a casting direction derived from age, personality, and narrative role, not a canonical physical fact. Never invent physical traits. Also extract only visually identity-defining recurring locations or objects whose consistency would materially matter across scenes. Ignore ordinary rooms, generic furniture, incidental props, and one-off scenery. Mark a truly central anchor essential and every other retained anchor useful; never retain a world element with referencePriority none. Keep at most eight world elements for the entire book.`,
          prompt: `CHAPTER_ID: ${chapter.id}\nCURRENT_CHARACTERS:\n${JSON.stringify(currentCharacters)}\nCURRENT_WORLD_ELEMENTS:\n${JSON.stringify(currentWorldElements)}\nCHAPTER_TEXT:\n${chapter.text}`,
          onStatus: (detail) => onProgress({ stepId: 'registry-analysis', detail: `${chapter.title} · ${detail}` })
        });
        currentCharacters = mergeCharacters(currentCharacters, patch.characters.map((character) => ({ ...character, id: safePart(character.id || character.canonicalName) })));
        currentWorldElements = mergeWorldElements(currentWorldElements, patch.worldElements.map((element) => ({ ...element, id: safePart(element.id || element.canonicalName) })));
        manifest.characters = currentCharacters;
        manifest.worldElements = currentWorldElements;
        // Persisted after every chapter so an interrupted pass resumes from the
        // identities it already established instead of re-reading the whole book.
        await saveBookRegistry(bookId, { characters: currentCharacters, worldElements: currentWorldElements });
        await onProgress({ stepId: 'registry-analysis', completed: index + 1, total: manifest.chapters.length, detail: `Read ${index + 1} of ${manifest.chapters.length} chapters` });
      }
      return { characters: currentCharacters, worldElements: currentWorldElements };
    });
    await onProgress({ stepId: 'registry-analysis', status: 'completed', completed: manifest.chapters.length, total: manifest.chapters.length });
    const missingCharacterReferences = registry.characters.filter((character) => !character.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id));
    const missingWorldReferences = registry.worldElements.filter((element) => !element.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id));
    const missingReferences = missingCharacterReferences.length + missingWorldReferences.length;
    await onProgress({ stepId: 'registry-references', status: missingReferences ? 'running' : 'completed', completed: 0, total: missingReferences, detail: missingReferences ? 'Generating the first continuity reference' : 'All continuity references are cached' });
    if (missingReferences) await withLocalRuntime('image-generate', async () => {
      let completed = 0;
      for (const character of missingCharacterReferences) {
        const reference = await service.image.generate({
          bookId, artifactName: `${character.id}-reference-${manifest.visualStyle.id}`, kind: 'character-reference', characters: [character], worldElements: [], seed: seed(`${bookId}:${character.id}:${manifest.visualStyle.id}`), styleId: manifest.visualStyle.id,
          prompt: `${manifest.visualStyle.prompt} Create exactly one full-body portrait of one fictional character on a plain neutral illustrated background. Subject: ${character.canonicalName}. Canonical traits supported by the book: ${character.physicalDescription}. Casting mood only: ${character.personality}. Use a natural relaxed three-quarter stance and keep the complete silhouette visible. This is a clean visual identity reference, not a designed character sheet. No photography, live-action person, other people, duplicate pose, split screen, collage, panels, inset images, captions, labels, diagrams, arrows, measurements, logos, letters, or readable text.`
        });
        character.referenceImages = [reference, ...character.referenceImages];
        completed += 1;
        await onProgress({ stepId: 'registry-references', completed, total: missingReferences, detail: `Generated ${completed} of ${missingReferences} continuity references` });
      }
      for (const element of missingWorldReferences) {
        const reference = await service.image.generate({
          bookId, artifactName: `${element.id}-reference-${manifest.visualStyle.id}`, kind: 'world-reference', characters: [], worldElements: [element], seed: seed(`${bookId}:${element.id}:${manifest.visualStyle.id}`), styleId: manifest.visualStyle.id,
          prompt: `${manifest.visualStyle.prompt} Create exactly one clean establishing reference image of the recurring ${element.kind} “${element.canonicalName}”. Canonical visual evidence: ${element.visualDescription}. Continuity role: ${element.continuityRole}. Show one coherent illustrated view with no people unless the evidence explicitly requires them. No photography, alternate versions, split screen, collage, panels, inset images, captions, labels, diagrams, arrows, logos, letters, or readable text.`
        });
        element.referenceImages = [reference, ...element.referenceImages];
        completed += 1;
        await onProgress({ stepId: 'registry-references', completed, total: missingReferences, detail: `Generated ${completed} of ${missingReferences} continuity references` });
      }
    });
    await onProgress({ stepId: 'registry-references', status: 'completed', completed: missingReferences, total: missingReferences });
    manifest.characters = registry.characters;
    manifest.worldElements = registry.worldElements;
    manifest.voices = assignVoiceProfiles(manifest, service.speech);
    manifest.registryStatus = 'ready';
    await saveBookRegistry(bookId, {
      characters: manifest.characters,
      worldElements: manifest.worldElements,
      voices: manifest.voices,
      registryStatus: 'ready'
    });
    return manifest;
  } catch (error) {
    manifest.registryStatus = registryAlreadyAnalyzed ? 'ready' : 'failed';
    await saveBookRegistry(bookId, { registryStatus: manifest.registryStatus });
    throw error;
  }
}

export async function regenerateCharacterReference(context: RunContext, characterId: string, onProgress: ProgressReporter = noProgress) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const { bookId } = context;
  const manifest = await getManifest(context.userId, bookId);
  const character = manifest.characters.find((candidate) => candidate.id === characterId);
  if (!character) throw new Error('Character not found');
  const service = providers(context);
  const regenerationId = Date.now();
  await onProgress({ stepId: 'character-reference', status: 'running', completed: 0, total: 1, detail: `Regenerating ${character.canonicalName}` });
  const reference = await withLocalRuntime('image-generate', () => service.image.generate({
    bookId,
    artifactName: `${character.id}-reference-${manifest.visualStyle.id}-${regenerationId}`,
    kind: 'character-reference',
    characters: [character],
    worldElements: [],
    seed: seed(`${bookId}:${character.id}:${manifest.visualStyle.id}:${regenerationId}`),
    styleId: manifest.visualStyle.id,
    prompt: `${manifest.visualStyle.prompt} Create exactly one full-body portrait of one fictional character on a plain neutral illustrated background. Subject: ${character.canonicalName}. Canonical traits supported by the book: ${character.physicalDescription}. Casting mood only: ${character.personality}. Use a natural relaxed three-quarter stance and keep the complete silhouette visible. This is a clean visual identity reference, not a designed character sheet. No photography, live-action person, other people, duplicate pose, split screen, collage, panels, inset images, captions, labels, diagrams, arrows, measurements, logos, letters, or readable text.`
  }));
  character.referenceImages = [reference, ...character.referenceImages];
  await saveBookRegistry(bookId, { characters: manifest.characters });
  await onProgress({ stepId: 'character-reference', status: 'completed', completed: 1, total: 1, detail: `Regenerated ${character.canonicalName}` });
  return manifest;
}

export async function prepareChapter(
  context: RunContext,
  chapterId: string,
  onProgress: ProgressReporter = noProgress,
  options: { force?: boolean; generationId?: string } = {}
) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const { bookId } = context;
  const cached = await getRenderedChapter(bookId, chapterId);
  if (cached && !options.force) return cached;
  let manifest = await getManifest(context.userId, bookId);
  const referencesOutdated = manifest.characters.some((character) => !character.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id))
    || manifest.worldElements.some((element) => !element.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id));
  if (manifest.registryStatus !== 'ready' || referencesOutdated) {
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
  const visualRange = visualBeatRange(chapter.text);
  const service = providers(context);
  const generationSuffix = options.generationId ? `-${safePart(options.generationId)}` : '';
  const voiceRegistryCurrent = manifest.voices.some((voice) => voice.characterId === 'narrator')
    && manifest.characters.every((character) => manifest.voices.some((voice) => voice.characterId === character.id))
    && manifest.voices.every((voice) => voice.model === service.speech.model && service.speech.voiceOptions.some((option) => option.id === voice.voiceId));
  if (!voiceRegistryCurrent) {
    manifest.voices = assignVoiceProfiles(manifest, service.speech);
    await saveBookRegistry(bookId, { voices: manifest.voices });
  }
  let plan: z.infer<typeof ChapterPlanSchema> | undefined;
  const storedCheckpoint = options.generationId
    ? await getChapterGenerationCheckpoint(context.userId, options.generationId, bookId, chapterId)
    : null;
  if (storedCheckpoint?.kind === 'chapter') {
    try {
      plan = validateVisualBeatCoverage(validateChapterPlan(
        chapter.text,
        chapter.id,
        manifest.characters.map((character) => character.id),
        locateChapterPlanText(chapter.text, splitAttributedNarration(storedCheckpoint.plan)),
        manifest.worldElements.map((element) => element.id)
      ), visualRange.minimum, visualRange.maximum);
    } catch {
      plan = undefined;
    }
  }
  await onProgress({
    stepId: 'plan',
    status: plan ? 'completed' : 'running',
    completed: plan ? 1 : 0,
    total: 1,
    detail: plan ? 'Resuming the validated chapter plan' : 'Splitting the chapter into spoken passages and visual beats',
    chapterPlan: plan
  });
  let rejectedPlan: z.infer<typeof ChapterPlanSchema> | undefined;
  let planError = '';
  if (!plan) await withLocalRuntime('text', async () => {
    for (let planAttempt = 1; planAttempt <= 3; planAttempt += 1) {
      // The rewrite counter only means something once a plan has actually been rejected,
      // so the first pass says what it is doing instead of counting attempts.
      const rewriteLabel = planAttempt === 1 ? '' : `Plan rewrite ${planAttempt - 1} of 2`;
      if (rewriteLabel) await onProgress({ stepId: 'plan', status: 'running', detail: `${rewriteLabel} · previous plan rejected: ${shorten(planError)}` });
      const correction = rejectedPlan
        ? `\n\nPREVIOUS_PLAN_REJECTED:\n${JSON.stringify(rejectedPlan)}\n\nVALIDATION_ERROR:\n${planError}\nReturn a complete corrected plan. Do not patch only one utterance.`
        : '';
      const candidate = await service.text.generate({
        schema: ChapterPlanSchema,
        schemaName: 'chapter-plan',
        timeoutMs: 300_000,
        providerAttempts: 2,
        system: `Create an audiobook performance plan from the complete chapter. Preserve every original word exactly once across ordered utterances: no omissions, additions, summaries, overlaps, or reordered passages. Attribute dialogue only when certain. Keep a spoken line and the attribution belonging to its sentence in the same utterance attributed to the speaker; the pipeline separates the quoted or dash-marked speech from the attribution deterministically. Never attribute an utterance that contains no spoken line to a character unless it continues that character's speech. Keep adjacent narration by the same speaker in coherent passages, normally 40-220 characters; avoid tiny fragments under 20 characters unless the source contains a genuinely standalone brief line of dialogue. Choose ${visualRange.minimum}-${visualRange.maximum} visually distinct, meaningful visual beats distributed across the whole chapter, including at least one in its opening third and one in its final third. Use stable character and world-element IDs from the registries. Attach a world element only when it is actually visible and continuity-relevant in that scene. Visual prompts describe content and composition, not a competing medium or art style. Do not request realism or photography. Do not include sound effects unless narratively useful.`,
        prompt: `CHAPTER_ID: ${chapter.id}\nCHAPTER_TITLE: ${chapter.title}\nCHAPTER_TEXT:\n${chapter.text}\n\nCHARACTER_REGISTRY:\n${JSON.stringify(manifest.characters)}\n\nWORLD_REGISTRY:\n${JSON.stringify(manifest.worldElements)}${correction}`,
        onStatus: (detail) => onProgress({ stepId: 'plan', status: 'running', detail: rewriteLabel ? `${rewriteLabel} · ${detail}` : detail })
      });
      try {
        plan = validateVisualBeatCoverage(validateChapterPlan(
          chapter.text,
          chapter.id,
          manifest.characters.map((character) => character.id),
          locateChapterPlanText(chapter.text, splitAttributedNarration(candidate)),
          manifest.worldElements.map((element) => element.id)
        ), visualRange.minimum, visualRange.maximum);
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
  await onProgress({ stepId: 'plan', status: 'completed', completed: 1, total: 1, detail: `${finalPlan.utterances.length} passages and ${finalPlan.visuals.length} visual beats planned`, chapterPlan: finalPlan });

  const audioUtterances = await generateOrResumeChapterAudio({
    context,
    chapterId,
    kind: 'chapter',
    generationId: options.generationId,
    plan: finalPlan,
    manifest,
    speech: service.speech,
    artifactName: (utteranceId) => `${chapter.id}-${utteranceId}${generationSuffix}`,
    onProgress,
    action: 'Generated'
  });

  const renderedUtterances: RenderedChapter['utterances'] = [];
  let timelineMs = 0;
  await onProgress({ stepId: 'alignment', status: 'running', completed: 0, total: audioUtterances.length, detail: 'Synchronizing the first passage' });
  await withLocalRuntime('alignment', async () => {
    for (const [index, item] of audioUtterances.entries()) {
      const alignment = await service.aligner.align(item.audio, item.utterance.text, item.durationMs);
      const renderedUtterance = { utterance: item.utterance, audio: item.audio, voice: { ...item.voice, voiceId: item.audio.voiceId ?? item.voice.voiceId, provider: item.audio.provider, model: item.audio.model }, startMs: timelineMs, durationMs: item.durationMs, words: alignment.words, alignment: alignment.quality };
      renderedUtterances.push(renderedUtterance);
      timelineMs += item.durationMs + item.utterance.direction.pauseAfterMs;
      await onProgress({ stepId: 'alignment', completed: index + 1, total: audioUtterances.length, detail: `Synchronized ${index + 1} of ${audioUtterances.length} passages`, alignedPreview: renderedUtterance });
    }
  });
  await onProgress({ stepId: 'alignment', status: 'completed', completed: audioUtterances.length, total: audioUtterances.length });

  const visualJobs = finalPlan.visuals.map((cue) => ({
    cue,
    characters: cue.characterIds.map((id) => manifest.characters.find((character) => character.id === id)).filter(Boolean) as Character[],
    worldElements: cue.worldElementIds.map((id) => manifest.worldElements.find((element) => element.id === id)).filter(Boolean) as WorldElement[]
  }));
  const renderedVisuals: RenderedChapter['visuals'] = [];
  let completedVisuals = 0;
  await onProgress({ stepId: 'visuals', status: 'running', completed: 0, total: visualJobs.length, detail: visualJobs.length ? 'Staging the first scene' : 'No visual beats requested' });
  const generateVisuals = async (jobs: typeof visualJobs) => {
    for (const { cue, characters, worldElements } of jobs) {
      const anchor = renderedUtterances.find((item) => item.utterance.id === cue.utteranceId) ?? renderedUtterances[0];
      const image = await service.image.generate({
        bookId, artifactName: `${chapter.id}-${cue.id}-${manifest.visualStyle.id}${generationSuffix}`, kind: 'scene', characters, worldElements, seed: seed(`${bookId}:${chapter.id}:${cue.id}:${manifest.visualStyle.id}:${options.generationId ?? 'initial'}`), styleId: manifest.visualStyle.id,
        prompt: `${manifest.visualStyle.prompt} Preserve identity and canonical traits from the supplied references, but render them in this exact illustrated medium rather than preserving photographic media. ${cue.prompt}\nShot: ${cue.shot}. Mood: ${cue.mood}. Characters present: ${characters.map((character) => `${character.canonicalName}: ${character.physicalDescription}`).join('; ') || 'none'}. Recurring visual anchors present: ${worldElements.map((element) => `${element.canonicalName}: ${element.visualDescription}`).join('; ') || 'none'}. Compose as one wide 16:9 cinematic storybook frame with all important subjects inside the central safe area. No photography, live-action frame, 3D render, split screen, collage, panels, captions, subtitles, signage, logos, letters, or readable text.`
      });
      const renderedVisual = { cue, image, startMs: anchor?.startMs ?? 0 };
      renderedVisuals.push(renderedVisual);
      completedVisuals += 1;
      await onProgress({ stepId: 'visuals', completed: completedVisuals, total: visualJobs.length, detail: `Generated ${completedVisuals} of ${visualJobs.length} scenes`, visualPreview: renderedVisual });
    }
  };
  const plainVisuals = visualJobs.filter(({ characters, worldElements }) => !characters.some((character) => character.referenceImages.length) && !worldElements.some((element) => element.referenceImages.length));
  const referenceVisuals = visualJobs.filter(({ characters, worldElements }) => characters.some((character) => character.referenceImages.length) || worldElements.some((element) => element.referenceImages.length));
  if (plainVisuals.length) await withLocalRuntime('image-generate', () => generateVisuals(plainVisuals));
  if (referenceVisuals.length) await withLocalRuntime('image-edit', () => generateVisuals(referenceVisuals));
  await onProgress({ stepId: 'visuals', status: 'completed', completed: visualJobs.length, total: visualJobs.length });
  renderedVisuals.sort((a, b) => finalPlan.visuals.indexOf(a.cue) - finalPlan.visuals.indexOf(b.cue));
  const rendered = { schemaVersion: 1 as const, chapterId, plan: finalPlan, utterances: renderedUtterances, visuals: renderedVisuals, totalDurationMs: Math.max(1, timelineMs), createdAt: new Date().toISOString() };
  await saveRenderedChapter(bookId, rendered);
  if (options.generationId) await clearChapterGenerationCheckpoint(context.userId, options.generationId);
  return rendered;
}

export async function regenerateChapterAudio(
  context: RunContext,
  chapterId: string,
  generationId: string,
  onProgress: ProgressReporter = noProgress
) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const { bookId } = context;
  const previous = await getRenderedChapter(bookId, chapterId);
  if (!previous) throw new Error('Prepare the chapter once before regenerating only its audio');
  const manifest = await getManifest(context.userId, bookId);
  const chapter = manifest.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const plan = validateChapterPlan(
    chapter.text,
    chapterId,
    manifest.characters.map((character) => character.id),
    locateChapterPlanText(chapter.text, splitAttributedNarration(previous.plan)),
    manifest.worldElements.map((element) => element.id)
  );
  const service = providers(context);
  const voiceRegistryCurrent = manifest.voices.some((voice) => voice.characterId === 'narrator')
    && manifest.characters.every((character) => manifest.voices.some((voice) => voice.characterId === character.id))
    && manifest.voices.every((voice) => voice.model === service.speech.model && service.speech.voiceOptions.some((option) => option.id === voice.voiceId));
  if (!voiceRegistryCurrent) {
    manifest.voices = assignVoiceProfiles(manifest, service.speech);
    await saveBookRegistry(bookId, { voices: manifest.voices });
  }

  const suffix = `-${safePart(generationId)}`;
  await onProgress({ stepId: 'speech', chapterPlan: plan });
  const generated = await generateOrResumeChapterAudio({
    context,
    chapterId,
    kind: 'chapter-audio',
    generationId,
    plan,
    manifest,
    speech: service.speech,
    artifactName: (utteranceId) => `${chapterId}-${utteranceId}${suffix}`,
    onProgress,
    action: 'Regenerated'
  });

  const utterances: RenderedChapter['utterances'] = [];
  let timelineMs = 0;
  await onProgress({ stepId: 'alignment', status: 'running', completed: 0, total: generated.length, detail: 'Realigning the first passage' });
  await withLocalRuntime('alignment', async () => {
    for (const [index, item] of generated.entries()) {
      const alignment = await service.aligner.align(item.audio, item.utterance.text, item.durationMs);
      const renderedUtterance: RenderedChapter['utterances'][number] = {
        utterance: item.utterance,
        audio: item.audio,
        voice: { ...item.voice, voiceId: item.audio.voiceId ?? item.voice.voiceId, provider: item.audio.provider, model: item.audio.model },
        startMs: timelineMs,
        durationMs: item.durationMs,
        words: alignment.words,
        alignment: alignment.quality
      };
      utterances.push(renderedUtterance);
      timelineMs += item.durationMs + item.utterance.direction.pauseAfterMs;
      await onProgress({ stepId: 'alignment', completed: index + 1, total: generated.length, detail: `Realigned ${index + 1} of ${generated.length} passages`, alignedPreview: renderedUtterance });
    }
  });
  await onProgress({ stepId: 'alignment', status: 'completed', completed: generated.length, total: generated.length });

  const visuals = previous.visuals.map((visual) => {
    const cue = plan.visuals.find((candidate) => candidate.id === visual.cue.id) ?? visual.cue;
    return { ...visual, cue, startMs: utterances.find((item) => item.utterance.id === cue.utteranceId)?.startMs ?? 0 };
  });
  const rendered: RenderedChapter = {
    ...previous,
    plan,
    utterances,
    visuals,
    totalDurationMs: Math.max(1, timelineMs),
    createdAt: new Date().toISOString()
  };
  await saveRenderedChapter(bookId, rendered);
  await clearChapterGenerationCheckpoint(context.userId, generationId);
  return rendered;
}

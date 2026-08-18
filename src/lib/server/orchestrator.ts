import { createHash, randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import { z } from 'zod';
import { BookManifestSchema, ChapterPlanSchema, CharacterSchema, CoverConceptSchema, WorldElementSchema, type BookManifest, type ChapterPlan, type Character, type GenerationAudioPreview, type RenderedChapter, type WorldElement } from '../core/schemas';
import { locateChapterPlanText, splitAttributedNarration, validateChapterPlan, validateVisualBeatCoverage, visualBeatRange } from '../core/plan';
import { authoringContextBlock, authoringContextFor, withAuthoringContext } from '../core/authoring';
import { parseBook } from './ingest';
import { describeMissingCredentials, type RunContext } from './context';
import { createBook, getManifest, getRenderedChapter, readArtifact, saveBookRegistry, saveRenderedChapter, safePart } from './store';
import { providers } from './providers/router';
import { isRetryableProviderFailure } from './providers/failures';
import { runInLanes } from './concurrency';
import { getConfig } from './config';
import { usesLocalRuntime, withLocalRuntime } from './runtime';
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
  /**
   * Share of the time budget the model call behind this step has used. Reported only
   * while that call is in flight, so the step's bar keeps moving without the page having
   * to print a stopwatch.
   */
  progress?: number;
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
  const pending = plan.utterances.filter((utterance) => !reusable.has(utterance.id));
  // A cloud provider answers each passage independently, and a chapter is often a hundred
  // of them; a local engine holds one model and must stay serial.
  const lanes = usesLocalRuntime('speech') ? 1 : Math.max(1, Math.min(getConfig().speechConcurrency, pending.length));
  await onProgress({
    stepId: 'speech',
    status: 'running',
    completed: 0,
    total: plan.utterances.length,
    detail: reusable.size
      ? 'Reusing passages already recorded'
      : lanes > 1
        ? `${action === 'Generated' ? 'Recording' : 'Recording again'} ${lanes} passages at a time`
        : `${action === 'Generated' ? 'Recording' : 'Recording again'} the first passage`
  });

  // Several passages can finish at the same moment, and the checkpoint holds the complete
  // snapshot: writes are chained so the last one to land is never an older picture.
  let checkpointTail: Promise<void> = Promise.resolve();
  const persistCheckpoint = async () => {
    if (!checkpointBase) return;
    const previous = checkpointTail;
    let release!: () => void;
    checkpointTail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      await saveChapterGenerationCheckpoint({
        ...checkpointBase,
        audioPreview: plan.utterances.map((item) => reusable.get(item.id)).filter(Boolean) as GenerationAudioPreview[],
        updatedAt: new Date().toISOString()
      });
    } finally {
      release();
    }
  };

  /**
   * One passage, with its own retries. A gateway error or an empty stream after HTTP 200
   * is a property of that single request; failing the whole chapter for it would discard
   * every other passage in flight and force a resume for one lost sentence.
   */
  const synthesizePassage = async (utterance: ChapterPlan['utterances'][number], voice: ReturnType<typeof voiceFor>) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await speech.synthesize({
          bookId: context.bookId,
          artifactName: artifactName(utterance.id),
          text: utterance.text,
          voice,
          emotion: utterance.direction.emotion,
          intensity: utterance.direction.intensity,
          pace: utterance.direction.pace
        });
      } catch (error) {
        lastError = error;
        if (!isRetryableProviderFailure(error) || attempt === 3) throw error;
        await onProgress({
          stepId: 'speech',
          completed: completedCount,
          total: plan.utterances.length,
          detail: 'Recording again one passage that did not arrive'
        });
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('The speech provider could not produce this passage');
  };

  const record = async (utterance: ChapterPlan['utterances'][number], voice: ReturnType<typeof voiceFor>, preview: GenerationAudioPreview, reused: boolean) => {
    completed.set(utterance.id, { utterance, voice, audio: preview.audio, durationMs: preview.durationMs });
    completedCount += 1;
    await onProgress({
      stepId: 'speech',
      completed: completedCount,
      total: plan.utterances.length,
      detail: reused ? 'Reusing a passage already recorded' : action === 'Generated' ? 'Recording the voices' : 'Recording the voices again',
      audioPreview: preview
    });
  };

  // Everything the checkpoint already holds is published first, so a resumed job shows its
  // recovered passages immediately instead of after the first new synthesis.
  for (const utterance of plan.utterances) {
    const preview = reusable.get(utterance.id);
    if (preview) await record(utterance, voiceFor(utterance.speakerCharacterId, manifest), preview, true);
  }

  const processPassages = async () => {
    let next = 0;
    let stopped = false;
    const lane = async () => {
      while (!stopped) {
        const utterance = pending[next];
        next += 1;
        if (!utterance) return;
        try {
          const voice = voiceFor(utterance.speakerCharacterId, manifest);
          const audio = await synthesizePassage(utterance, voice);
          let durationMs = Math.max(800, utterance.text.split(/\s+/).length / 2.45 * 1000);
          try {
            const metadata = await parseBuffer(await readArtifact(audio), { mimeType: audio.mimeType });
            if (metadata.format.duration) durationMs = metadata.format.duration * 1000;
          } catch { /* retain the explicit approximate duration */ }
          const preview: GenerationAudioPreview = {
            utterance,
            audio,
            voice: { ...voice, voiceId: audio.voiceId ?? voice.voiceId, provider: audio.provider, model: audio.model },
            durationMs
          };
          reusable.set(utterance.id, preview);
          await persistCheckpoint();
          await record(utterance, voice, preview, false);
        } catch (error) {
          // One passage cannot be produced: stop handing out new work so the job fails
          // fast, with every passage completed so far already in the checkpoint.
          stopped = true;
          throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: lanes }, () => lane()));
    await checkpointTail.catch(() => {});
  };

  if (pending.length) await withLocalRuntime('speech', processPassages);
  await onProgress({ stepId: 'speech', status: 'completed', completed: plan.utterances.length, total: plan.utterances.length });
  return plan.utterances.map((utterance) => completed.get(utterance.id)!);
}

/**
 * The one property a cover must have here: it is an image, not a book jacket. Typography is
 * added by the reader's interface, which already knows the title, so any lettering the model
 * invents would be a second, permanently wrong title baked into the artwork.
 */
const COVER_WITHOUT_TEXT = 'Draw no lettering of any kind anywhere in the frame: no title, author name, series name, tagline, publisher mark, sticker, badge, caption, page number, watermark, signature, or invented writing, including on signs, books, spines, banners, or objects inside the scene. No border, frame, mockup of a printed book, or empty band reserved for a title.';

/**
 * Draws the wordless key image for a whole book. The concept is decided first, from the
 * book itself, so the cover states one memorable idea rather than averaging the manuscript;
 * the identities it may show are conditioned on the reference sheets the registry just drew.
 */
async function generateBookCover(options: {
  context: RunContext;
  manifest: BookManifest;
  service: ReturnType<typeof providers>;
  authoringContext: ReturnType<typeof authoringContextFor>;
  onProgress: ProgressReporter;
  /** Set when a cover is drawn again on request, so the previous one keeps its bytes. */
  variant?: string;
}) {
  const { context, manifest, service, authoringContext, onProgress, variant } = options;
  const { bookId } = context;
  const styleId = manifest.visualStyle.id;
  const hasReference = (images: { styleId?: string }[]) => images.some((image) => image.styleId === styleId);
  const leadCharacters = manifest.characters.filter((character) => hasReference(character.referenceImages)).slice(0, 2);
  const anchorElements = manifest.worldElements
    .filter((element) => element.referencePriority === 'essential' && hasReference(element.referenceImages))
    .slice(0, 1);

  const concept = await withLocalRuntime('text', () => service.text.generate({
    schema: CoverConceptSchema,
    schemaName: 'cover-concept',
    system: withAuthoringContext('Design the cover image of a book as a single memorable picture. Choose one clear subject that a reader could recall and recognise later — a character in a defining moment, a decisive object, or a place that carries the story — and reject anything generic, busy, or merely decorative. Everything you describe is drawn: never plan for a title, byline, or any lettering, and never plan a layout that leaves space for one. Base the choice only on what the book actually contains.', authoringContext),
    prompt: `BOOK_TITLE: ${manifest.title}\n${authoringContextBlock(authoringContext)}CHARACTERS:\n${JSON.stringify(manifest.characters.map((character) => ({ name: character.canonicalName, appearance: character.physicalDescription, role: character.narrativeRole })))}\n\nWORLD_ELEMENTS:\n${JSON.stringify(manifest.worldElements.map((element) => ({ name: element.canonicalName, kind: element.kind, appearance: element.visualDescription, role: element.continuityRole })))}\n\nOPENING_EXCERPT:\n${manifest.chapters[0]?.text.slice(0, 3_000) ?? ''}\n\nCLOSING_EXCERPT:\n${manifest.chapters.at(-1)?.text.slice(-2_000) ?? ''}`,
    onStatus: (status) => onProgress({ stepId: 'registry-cover', status: 'running', detail: status.detail, progress: status.progress })
  }));

  await onProgress({ stepId: 'registry-cover', status: 'running', detail: 'Painting the cover' });
  return withLocalRuntime(leadCharacters.length || anchorElements.length ? 'image-edit' : 'image-generate', () => service.image.generate({
    bookId,
    artifactName: variant ? `cover-${styleId}-${variant}` : `cover-${styleId}`,
    kind: 'cover',
    characters: leadCharacters,
    worldElements: anchorElements,
    seed: seed(`${bookId}:cover:${styleId}:${variant ?? 'initial'}`),
    styleId,
    prompt: `${manifest.visualStyle.prompt} Create exactly one book cover image in a tall portrait format. Subject: ${concept.concept}. Composition: ${concept.composition}. Palette: ${concept.palette}. Preserve identity and canonical traits from the supplied references, rendered in this exact illustrated medium. Make it read instantly at thumbnail size: one dominant subject, strong silhouette, deliberate negative space, and no crowded detail. ${COVER_WITHOUT_TEXT} No photography, live-action frame, 3D render, split screen, collage, or panels.`
  }));
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
  // Books written from a prompt keep their authoring request and outline as secondary
  // recognition context; imported books have none and run the pipeline unchanged.
  const authoringContext = authoringContextFor(manifest);
  manifest.registryStatus = 'processing';
  await saveBookRegistry(bookId, { registryStatus: 'processing' });
  const service = providers(context);
  try {
    await onProgress({
      stepId: 'registry-analysis', status: registryAlreadyAnalyzed ? 'completed' : 'running',
      completed: registryAlreadyAnalyzed ? manifest.chapters.length : 0, total: manifest.chapters.length,
      detail: registryAlreadyAnalyzed ? 'The cast and the places are already up to date' : 'Reading the first chapter'
    });
    const registry = registryAlreadyAnalyzed ? { characters: manifest.characters, worldElements: manifest.worldElements } : await withLocalRuntime('text', async () => {
      let currentCharacters = manifest.characters;
      let currentWorldElements = manifest.worldElements;
      for (const [index, chapter] of manifest.chapters.entries()) {
        const patch = await service.text.generate({
          schema: RegistryPatchSchema,
          schemaName: 'registry-patch',
          system: withAuthoringContext(`Update the story registries from textual evidence. Extract characters conservatively and deduplicate against the supplied registry. For every character, set voiceGender to female, male, or neutral only when supported by the text; otherwise use unknown. voiceDescription is a casting direction derived from age, personality, and narrative role, not a canonical physical fact. Never invent physical traits. Also extract only visually identity-defining recurring locations or objects whose consistency would materially matter across scenes. Ignore ordinary rooms, generic furniture, incidental props, and one-off scenery. Mark a truly central anchor essential and every other retained anchor useful; never retain a world element with referencePriority none. Keep at most eight world elements for the entire book.`, authoringContext),
          prompt: `CHAPTER_ID: ${chapter.id}\nCURRENT_CHARACTERS:\n${JSON.stringify(currentCharacters)}\nCURRENT_WORLD_ELEMENTS:\n${JSON.stringify(currentWorldElements)}\n${authoringContextBlock(authoringContext)}CHAPTER_TEXT:\n${chapter.text}`,
          onStatus: (status) => onProgress({ stepId: 'registry-analysis', detail: `${chapter.title} · ${status.detail}`, progress: status.progress })
        });
        currentCharacters = mergeCharacters(currentCharacters, patch.characters.map((character) => ({ ...character, id: safePart(character.id || character.canonicalName) })));
        currentWorldElements = mergeWorldElements(currentWorldElements, patch.worldElements.map((element) => ({ ...element, id: safePart(element.id || element.canonicalName) })));
        manifest.characters = currentCharacters;
        manifest.worldElements = currentWorldElements;
        // Persisted after every chapter so an interrupted pass resumes from the
        // identities it already established instead of re-reading the whole book.
        await saveBookRegistry(bookId, { characters: currentCharacters, worldElements: currentWorldElements });
        // No detail here on purpose: the count and its bar already say how far this got.
        await onProgress({ stepId: 'registry-analysis', completed: index + 1, total: manifest.chapters.length });
      }
      return { characters: currentCharacters, worldElements: currentWorldElements };
    });
    await onProgress({ stepId: 'registry-analysis', status: 'completed', completed: manifest.chapters.length, total: manifest.chapters.length });
    const missingCharacterReferences = registry.characters.filter((character) => !character.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id));
    const missingWorldReferences = registry.worldElements.filter((element) => !element.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id));
    const missingReferences = missingCharacterReferences.length + missingWorldReferences.length;
    await onProgress({ stepId: 'registry-references', status: missingReferences ? 'running' : 'completed', completed: 0, total: missingReferences, detail: missingReferences ? 'Drawing the first reference sheet' : 'Every reference sheet is already drawn' });
    // Reference sheets are independent images; only a local runtime has to draw them one
    // at a time. Progress stays a count, so lanes finishing out of order remain truthful.
    const imageLanes = usesLocalRuntime('image-generate') ? 1 : getConfig().imageConcurrency;
    if (missingReferences) await withLocalRuntime('image-generate', async () => {
      let completed = 0;
      await runInLanes(missingCharacterReferences, imageLanes, async (character) => {
        const reference = await service.image.generate({
          bookId, artifactName: `${character.id}-reference-${manifest.visualStyle.id}`, kind: 'character-reference', characters: [character], worldElements: [], seed: seed(`${bookId}:${character.id}:${manifest.visualStyle.id}`), styleId: manifest.visualStyle.id,
          prompt: `${manifest.visualStyle.prompt} Create exactly one full-body portrait of one fictional character on a plain neutral illustrated background. Subject: ${character.canonicalName}. Canonical traits supported by the book: ${character.physicalDescription}. Casting mood only: ${character.personality}. Use a natural relaxed three-quarter stance and keep the complete silhouette visible. This is a clean visual identity reference, not a designed character sheet. No photography, live-action person, other people, duplicate pose, split screen, collage, panels, inset images, captions, labels, diagrams, arrows, measurements, logos, letters, or readable text.`
        });
        character.referenceImages = [reference, ...character.referenceImages];
        completed += 1;
        await onProgress({ stepId: 'registry-references', completed, total: missingReferences });
      });
      await runInLanes(missingWorldReferences, imageLanes, async (element) => {
        const reference = await service.image.generate({
          bookId, artifactName: `${element.id}-reference-${manifest.visualStyle.id}`, kind: 'world-reference', characters: [], worldElements: [element], seed: seed(`${bookId}:${element.id}:${manifest.visualStyle.id}`), styleId: manifest.visualStyle.id,
          prompt: `${manifest.visualStyle.prompt} Create exactly one clean establishing reference image of the recurring ${element.kind} “${element.canonicalName}”. Canonical visual evidence: ${element.visualDescription}. Continuity role: ${element.continuityRole}. Show one coherent illustrated view with no people unless the evidence explicitly requires them. No photography, alternate versions, split screen, collage, panels, inset images, captions, labels, diagrams, arrows, logos, letters, or readable text.`
        });
        element.referenceImages = [reference, ...element.referenceImages];
        completed += 1;
        await onProgress({ stepId: 'registry-references', completed, total: missingReferences });
      });
    });
    await onProgress({ stepId: 'registry-references', status: 'completed', completed: missingReferences, total: missingReferences });
    manifest.characters = registry.characters;
    manifest.worldElements = registry.worldElements;

    // The cover is drawn last: it is the only image that describes the whole book, so it
    // can only be composed once the cast and the recurring places are settled.
    const coverOutdated = manifest.coverImage?.styleId !== manifest.visualStyle.id;
    await onProgress({
      stepId: 'registry-cover',
      status: coverOutdated ? 'running' : 'completed',
      completed: coverOutdated ? 0 : 1,
      total: 1,
      detail: coverOutdated ? 'Deciding what the cover should show' : 'The cover is already painted'
    });
    if (coverOutdated) {
      manifest.coverImage = await generateBookCover({ context, manifest, service, authoringContext, onProgress });
    }
    await onProgress({ stepId: 'registry-cover', status: 'completed', completed: 1, total: 1 });

    manifest.voices = assignVoiceProfiles(manifest, service.speech);
    manifest.registryStatus = 'ready';
    await saveBookRegistry(bookId, {
      characters: manifest.characters,
      worldElements: manifest.worldElements,
      voices: manifest.voices,
      coverImage: manifest.coverImage,
      registryStatus: 'ready'
    });
    return manifest;
  } catch (error) {
    manifest.registryStatus = registryAlreadyAnalyzed ? 'ready' : 'failed';
    await saveBookRegistry(bookId, { registryStatus: manifest.registryStatus });
    throw error;
  }
}

/**
 * Draws only the cover, for a book whose registry ran before covers existed or whose cover
 * the owner wants redrawn. It deliberately does not require a registry: without reference
 * sheets the cover is composed from the manuscript alone rather than refusing to exist.
 */
export async function generateBookCoverOnly(context: RunContext, onProgress: ProgressReporter = noProgress) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);
  const manifest = await getManifest(context.userId, context.bookId);
  if (!manifest.chapters.length) throw new Error('This book has no manuscript to draw a cover from');
  await onProgress({ stepId: 'registry-cover', status: 'running', completed: 0, total: 1, detail: 'Deciding what the cover should show' });
  const coverImage = await generateBookCover({
    context,
    manifest,
    service: providers(context),
    authoringContext: authoringContextFor(manifest),
    onProgress,
    variant: manifest.coverImage ? String(Date.now()) : undefined
  });
  await saveBookRegistry(context.bookId, { coverImage });
  await onProgress({ stepId: 'registry-cover', status: 'completed', completed: 1, total: 1, detail: 'The cover is ready' });
  return { ...manifest, coverImage };
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
  await onProgress({ stepId: 'character-reference', status: 'running', completed: 0, total: 1, detail: `Drawing ${character.canonicalName} again` });
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
  await onProgress({ stepId: 'character-reference', status: 'completed', completed: 1, total: 1, detail: `${character.canonicalName} is ready` });
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
    || manifest.worldElements.some((element) => !element.referenceImages.some((reference) => reference.styleId === manifest.visualStyle.id))
    || manifest.coverImage?.styleId !== manifest.visualStyle.id;
  if (manifest.registryStatus !== 'ready' || referencesOutdated) {
    await onProgress({ stepId: 'registry', status: 'running', completed: 0, total: 1, detail: 'Getting to know the characters first' });
    const chapterCount = manifest.chapters.length;
    manifest = await prepareRegistry(context, async (update) => {
      const isReferences = update.stepId === 'registry-references';
      const isCover = update.stepId === 'registry-cover';
      await onProgress({
        stepId: 'registry',
        status: update.status === 'failed' ? 'failed' : update.status === 'completed' && isCover ? 'completed' : 'running',
        completed: (isReferences || isCover ? chapterCount : 0) + (update.completed ?? 0),
        total: chapterCount + (isReferences || isCover ? update.total ?? 0 : 1),
        detail: update.detail ?? (isCover ? 'Painting the cover' : isReferences ? 'Drawing the character sheets' : 'Reading the book for its characters')
      });
    });
  }
  await onProgress({ stepId: 'registry', status: 'completed', completed: 1, total: 1, detail: 'The cast is ready' });
  const chapter = manifest.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error('Chapter not found');
  const visualRange = visualBeatRange(chapter.text);
  const authoringContext = authoringContextFor(manifest);
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
    detail: plan ? 'Picking up the direction already approved' : 'Deciding who speaks, how, and what we see',
    chapterPlan: plan
  });
  let rejectedPlan: z.infer<typeof ChapterPlanSchema> | undefined;
  let planError = '';
  if (!plan) await withLocalRuntime('text', async () => {
    for (let planAttempt = 1; planAttempt <= 3; planAttempt += 1) {
      // The take counter only means something once a plan has actually been rejected, so
      // the first pass says what it is doing instead of counting attempts. Why the previous
      // take was rejected is a validation detail: it belongs in the job error, not on a
      // line the reader is watching while they wait.
      const rewriteLabel = planAttempt === 1 ? '' : `Take ${planAttempt} of 3`;
      if (rewriteLabel) await onProgress({ stepId: 'plan', status: 'running', detail: `${rewriteLabel} · reworking the direction` });
      const correction = rejectedPlan
        ? `\n\nPREVIOUS_PLAN_REJECTED:\n${JSON.stringify(rejectedPlan)}\n\nVALIDATION_ERROR:\n${planError}\nReturn a complete corrected plan. Do not patch only one utterance.`
        : '';
      const candidate = await service.text.generate({
        schema: ChapterPlanSchema,
        schemaName: 'chapter-plan',
        timeoutMs: 300_000,
        providerAttempts: 2,
        system: withAuthoringContext(`Create an audiobook performance plan from the complete chapter. Preserve every original word exactly once across ordered utterances: no omissions, additions, summaries, overlaps, or reordered passages. Attribute dialogue only when certain. Keep a spoken line and the attribution belonging to its sentence in the same utterance attributed to the speaker; the pipeline separates the quoted or dash-marked speech from the attribution deterministically. Never attribute an utterance that contains no spoken line to a character unless it continues that character's speech. Keep adjacent narration by the same speaker in coherent passages, normally 40-220 characters; avoid tiny fragments under 20 characters unless the source contains a genuinely standalone brief line of dialogue. Choose ${visualRange.minimum}-${visualRange.maximum} visually distinct, meaningful visual beats distributed across the whole chapter, including at least one in its opening third and one in its final third. Use stable character and world-element IDs from the registries. Attach a world element only when it is actually visible and continuity-relevant in that scene. Visual prompts describe content and composition, not a competing medium or art style. Do not request realism or photography. Do not include sound effects unless narratively useful.`, authoringContext),
        prompt: `CHAPTER_ID: ${chapter.id}\nCHAPTER_TITLE: ${chapter.title}\n${authoringContextBlock(authoringContext)}CHAPTER_TEXT:\n${chapter.text}\n\nCHARACTER_REGISTRY:\n${JSON.stringify(manifest.characters)}\n\nWORLD_REGISTRY:\n${JSON.stringify(manifest.worldElements)}${correction}`,
        onStatus: (status) => onProgress({ stepId: 'plan', status: 'running', detail: rewriteLabel ? `${rewriteLabel} · ${status.detail}` : status.detail, progress: status.progress })
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
  await onProgress({ stepId: 'plan', status: 'completed', completed: 1, total: 1, detail: `${finalPlan.utterances.length} passages and ${finalPlan.visuals.length} scenes planned`, chapterPlan: finalPlan });

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
  await onProgress({ stepId: 'alignment', status: 'running', completed: 0, total: audioUtterances.length, detail: 'Matching the words to the audio' });
  await withLocalRuntime('alignment', async () => {
    for (const [index, item] of audioUtterances.entries()) {
      const alignment = await service.aligner.align(item.audio, item.utterance.text, item.durationMs);
      const renderedUtterance = { utterance: item.utterance, audio: item.audio, voice: { ...item.voice, voiceId: item.audio.voiceId ?? item.voice.voiceId, provider: item.audio.provider, model: item.audio.model }, startMs: timelineMs, durationMs: item.durationMs, words: alignment.words, alignment: alignment.quality };
      renderedUtterances.push(renderedUtterance);
      timelineMs += item.durationMs + item.utterance.direction.pauseAfterMs;
      await onProgress({ stepId: 'alignment', completed: index + 1, total: audioUtterances.length, alignedPreview: renderedUtterance });
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
  await onProgress({ stepId: 'visuals', status: 'running', completed: 0, total: visualJobs.length, detail: visualJobs.length ? 'Painting the first scene' : 'This chapter asked for no scenes' });
  const generateVisuals = async (jobs: typeof visualJobs, phase: 'image-generate' | 'image-edit') => {
    await runInLanes(jobs, usesLocalRuntime(phase) ? 1 : getConfig().imageConcurrency, async ({ cue, characters, worldElements }) => {
      const anchor = renderedUtterances.find((item) => item.utterance.id === cue.utteranceId) ?? renderedUtterances[0];
      const image = await service.image.generate({
        bookId, artifactName: `${chapter.id}-${cue.id}-${manifest.visualStyle.id}${generationSuffix}`, kind: 'scene', characters, worldElements, seed: seed(`${bookId}:${chapter.id}:${cue.id}:${manifest.visualStyle.id}:${options.generationId ?? 'initial'}`), styleId: manifest.visualStyle.id,
        prompt: `${manifest.visualStyle.prompt} Preserve identity and canonical traits from the supplied references, but render them in this exact illustrated medium rather than preserving photographic media. ${cue.prompt}\nShot: ${cue.shot}. Mood: ${cue.mood}. Characters present: ${characters.map((character) => `${character.canonicalName}: ${character.physicalDescription}`).join('; ') || 'none'}. Recurring visual anchors present: ${worldElements.map((element) => `${element.canonicalName}: ${element.visualDescription}`).join('; ') || 'none'}. Compose as one wide 16:9 cinematic storybook frame with all important subjects inside the central safe area. No photography, live-action frame, 3D render, split screen, collage, panels, captions, subtitles, signage, logos, letters, or readable text.`
      });
      const renderedVisual = { cue, image, startMs: anchor?.startMs ?? 0 };
      renderedVisuals.push(renderedVisual);
      completedVisuals += 1;
      await onProgress({ stepId: 'visuals', completed: completedVisuals, total: visualJobs.length, visualPreview: renderedVisual });
    });
  };
  const plainVisuals = visualJobs.filter(({ characters, worldElements }) => !characters.some((character) => character.referenceImages.length) && !worldElements.some((element) => element.referenceImages.length));
  const referenceVisuals = visualJobs.filter(({ characters, worldElements }) => characters.some((character) => character.referenceImages.length) || worldElements.some((element) => element.referenceImages.length));
  if (plainVisuals.length) await withLocalRuntime('image-generate', () => generateVisuals(plainVisuals, 'image-generate'));
  if (referenceVisuals.length) await withLocalRuntime('image-edit', () => generateVisuals(referenceVisuals, 'image-edit'));
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
  await onProgress({ stepId: 'alignment', status: 'running', completed: 0, total: generated.length, detail: 'Matching the words to the new audio' });
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
      await onProgress({ stepId: 'alignment', completed: index + 1, total: generated.length, alignedPreview: renderedUtterance });
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

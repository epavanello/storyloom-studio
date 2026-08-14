import { randomUUID } from 'node:crypto';
import {
  BookManifestSchema,
  GeneratedStoryChapterSchema,
  StoryCreationRequestSchema,
  StoryOutlineSchema,
  type BookOrigin,
  type StoryCreationRequest,
  type StoryOutline
} from '../core/schemas';
import { describeMissingCredentials, type RunContext } from './context';
import type { ProgressReporter } from './orchestrator';
import { providers } from './providers/router';
import { withLocalRuntime } from './runtime';
import { createBook, getManifest, saveGeneratedChapter, saveGeneratedStoryState } from './store';

const noProgress: ProgressReporter = async () => {};

function validateOutline(outline: StoryOutline, chapterCount: number) {
  if (outline.chapters.length !== chapterCount) {
    throw new Error(`The story outline contains ${outline.chapters.length} chapters instead of ${chapterCount}`);
  }
  outline.chapters.forEach((chapter, order) => {
    if (chapter.order !== order) throw new Error('The story outline chapter order is incomplete or duplicated');
  });
  return outline;
}

export async function createStoryDraft(userId: string, input: StoryCreationRequest) {
  const request = StoryCreationRequestSchema.parse(input);
  const id = `generated-story-${randomUUID().slice(0, 7)}`;
  const manifest = BookManifestSchema.parse({
    schemaVersion: 1,
    id,
    title: 'Story in progress',
    sourceName: 'AI-generated source · waiting for the writer',
    origin: {
      kind: 'generated',
      prompt: request.prompt,
      requestedChapterCount: request.chapterCount,
      status: 'pending'
    },
    createdAt: new Date().toISOString(),
    chapters: [],
    characters: [],
    worldElements: [],
    voices: [],
    registryStatus: 'pending'
  });
  await createBook(userId, manifest);
  return manifest;
}

/**
 * Writes an AI-authored source manuscript through the same single deployment queue as
 * media generation. Each complete chapter is committed independently, so a retry skips
 * immutable source text that was already generated successfully.
 */
export async function generateStory(context: RunContext, onProgress: ProgressReporter = noProgress) {
  const blocker = describeMissingCredentials(context);
  if (blocker) throw new Error(blocker);

  const manifest = await getManifest(context.userId, context.bookId);
  if (manifest.origin.kind !== 'generated') throw new Error('This book was imported and has no story-generation request');
  const service = providers(context);
  let origin: Extract<BookOrigin, { kind: 'generated' }> = {
    ...manifest.origin,
    status: 'generating' as const,
    provider: service.text.id,
    model: service.text.model
  };
  await saveGeneratedStoryState(context.userId, context.bookId, {
    origin,
    sourceName: `AI-generated source · ${service.text.id} / ${service.text.model}`
  });

  try {
    await withLocalRuntime('text', async () => {
      let outline = origin.outline;
      await onProgress({
        stepId: 'story-outline',
        status: outline ? 'completed' : 'running',
        completed: outline ? 1 : 0,
        total: 1,
        detail: outline ? 'Reusing the approved story structure' : 'Designing the complete narrative arc'
      });

      if (!outline) {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            const candidate = await service.text.generate({
              schema: StoryOutlineSchema,
              schemaName: 'story-outline',
              timeoutMs: 300_000,
              providerAttempts: 2,
              system: `Design the complete structure for an original work of fiction. The user's request is the creative source of truth. Return exactly the requested number of ordered chapters, numbered from zero. Keep one coherent narrative arc, stable character identities, explicit causal continuity, and a real ending. Write the story in the same language as the user's request unless the request explicitly asks for another language. This is an outline only; do not write chapter prose yet.`,
              prompt: `STORY_REQUEST_JSON:\n${JSON.stringify({ prompt: origin.prompt, chapterCount: origin.requestedChapterCount })}`,
              onStatus: (detail) => onProgress({ stepId: 'story-outline', status: 'running', detail: `${detail} · outline attempt ${attempt} of 2` })
            });
            outline = validateOutline(candidate, origin.requestedChapterCount);
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!outline) throw lastError instanceof Error ? lastError : new Error('The writer could not produce a valid story outline');
        origin = { ...origin, outline };
        await saveGeneratedStoryState(context.userId, context.bookId, { origin, title: outline.title });
      }
      await onProgress({ stepId: 'story-outline', status: 'completed', completed: 1, total: 1, detail: `${outline.chapters.length} chapters planned` });

      const chaptersByOrder = new Map(manifest.chapters.map((chapter) => [chapter.order, chapter]));
      await onProgress({
        stepId: 'story-chapters',
        status: 'running',
        completed: chaptersByOrder.size,
        total: origin.requestedChapterCount,
        detail: chaptersByOrder.size ? `Resuming after ${chaptersByOrder.size} completed chapters` : 'Writing the first complete chapter'
      });

      for (const specification of outline.chapters) {
        if (chaptersByOrder.has(specification.order)) continue;
        const previous = chaptersByOrder.get(specification.order - 1);
        let generated;
        let lastError: unknown;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            generated = await service.text.generate({
              schema: GeneratedStoryChapterSchema,
              schemaName: 'story-chapter',
              timeoutMs: 300_000,
              providerAttempts: 2,
              system: `Write one complete chapter of an original story. Produce polished narrative prose, not an outline, summary, screenplay, plan, commentary, or Markdown. Target roughly 900-1,400 words. Honor every established name, trait, relationship, event, setting, tone, and continuity constraint. Do not repeat the chapter title inside the prose. The chapter must advance the overall arc and end exactly where its outline intends.`,
              prompt: `STORY_REQUEST:\n${origin.prompt}\n\nCOMPLETE_OUTLINE_JSON:\n${JSON.stringify(outline)}\n\nCURRENT_CHAPTER_JSON:\n${JSON.stringify(specification)}\n\nPREVIOUS_CHAPTER_END:\n${previous?.text.slice(-4_000) ?? '(This is the opening chapter.)'}`,
              onStatus: (detail) => onProgress({
                stepId: 'story-chapters',
                status: 'running',
                completed: chaptersByOrder.size,
                total: origin.requestedChapterCount,
                detail: `${specification.title} · ${detail} · draft ${attempt} of 2`
              })
            });
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!generated) throw lastError instanceof Error ? lastError : new Error(`The writer could not complete ${specification.title}`);

        const chapter = {
          id: `chapter-${specification.order + 1}`,
          order: specification.order,
          title: generated.title,
          text: generated.text,
          characterCount: generated.text.length
        };
        await saveGeneratedChapter(context.userId, context.bookId, chapter);
        chaptersByOrder.set(chapter.order, chapter);
        await onProgress({
          stepId: 'story-chapters',
          completed: chaptersByOrder.size,
          total: origin.requestedChapterCount,
          detail: `Completed ${chaptersByOrder.size} of ${origin.requestedChapterCount} source chapters`
        });
      }

      if (chaptersByOrder.size !== origin.requestedChapterCount) {
        throw new Error(`The generated manuscript contains ${chaptersByOrder.size} of ${origin.requestedChapterCount} requested chapters`);
      }
      origin = { ...origin, status: 'ready', generatedAt: new Date().toISOString() };
      await saveGeneratedStoryState(context.userId, context.bookId, { origin, title: outline.title });
      await onProgress({
        stepId: 'story-chapters',
        status: 'completed',
        completed: origin.requestedChapterCount,
        total: origin.requestedChapterCount,
        detail: 'The complete source manuscript is ready to read or augment'
      });
    });
  } catch (error) {
    await saveGeneratedStoryState(context.userId, context.bookId, { origin: { ...origin, status: 'failed' } }).catch(() => {});
    throw error;
  }

  return getManifest(context.userId, context.bookId);
}

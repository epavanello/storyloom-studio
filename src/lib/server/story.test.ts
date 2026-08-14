import { describe, expect, it } from 'vitest';
import { GeneratedStoryChapterSchema, StoryCreationRequestSchema, StoryOutlineSchema } from '../core/schemas';
import { stepsFor } from './jobs';
import { MockStructuredProvider } from './providers/mock';

describe('generative source stories', () => {
  it('validates a bounded chapter count at the form boundary', () => {
    expect(StoryCreationRequestSchema.parse({ prompt: 'A complete mystery about a disappearing island.', chapterCount: '4' }).chapterCount).toBe(4);
    expect(StoryCreationRequestSchema.safeParse({ prompt: 'Too short', chapterCount: 3 }).success).toBe(false);
    expect(StoryCreationRequestSchema.safeParse({ prompt: 'A sufficiently detailed request for a story.', chapterCount: 13 }).success).toBe(false);
  });

  it('writes a complete deterministic mock outline and source chapter', async () => {
    const provider = new MockStructuredProvider();
    const outline = await provider.generate({
      schema: StoryOutlineSchema,
      schemaName: 'story-outline',
      system: '',
      prompt: `STORY_REQUEST_JSON:\n${JSON.stringify({ prompt: 'Una botanica cerca una foresta che ricorda il futuro.', chapterCount: 3 })}`
    });
    expect(outline.chapters.map((chapter) => chapter.order)).toEqual([0, 1, 2]);

    const specification = outline.chapters[0];
    const chapter = await provider.generate({
      schema: GeneratedStoryChapterSchema,
      schemaName: 'story-chapter',
      system: '',
      prompt: `STORY_REQUEST:\nUna botanica cerca una foresta che ricorda il futuro.\n\nCOMPLETE_OUTLINE_JSON:\n${JSON.stringify(outline)}\n\nCURRENT_CHAPTER_JSON:\n${JSON.stringify(specification)}\n\nPREVIOUS_CHAPTER_END:\n(This is the opening chapter.)`
    });
    expect(chapter.title).toBe(specification.title);
    expect(chapter.text.length).toBeGreaterThan(1_200);
    expect(chapter.text).not.toContain(`# ${specification.title}`);
  });

  it('exposes resumable outline and chapter-writing progress', () => {
    expect(stepsFor('story').map((step) => step.id)).toEqual(['story-outline', 'story-chapters']);
  });
});


import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CharacterSchema, ChapterPlanSchema } from '$lib/core/schemas';
import { validateChapterPlan } from '$lib/core/plan';
import { MockStructuredProvider } from './mock';

const CharacterPatchSchema = z.object({ characters: z.array(CharacterSchema) });

const chapterOne = `The rain had polished every stone in Via delle Rose when Anna reached the old observatory. She stopped beneath the copper dome.\n\n“Midnight. Come alone,” it read.\n\nMarco was already waiting inside. “You came,” he whispered.\n\n“Tell me the truth,” Anna said.`;
const chapterTwo = `At dawn Anna and Marco followed the map. Beside the final door they found the name Elena carved into the stone.`;

describe('deterministic demo provider', () => {
  it('extracts likely characters without treating sentence starts and street names as people', async () => {
    const provider = new MockStructuredProvider();
    const first = await provider.generate({
      schema: CharacterPatchSchema,
      schemaName: 'character-patch',
      system: '',
      prompt: `CHAPTER_ID: chapter-1\nCURRENT_REGISTRY:\n[]\nCHAPTER_TEXT:\n${chapterOne}`
    });
    const second = await provider.generate({
      schema: CharacterPatchSchema,
      schemaName: 'character-patch',
      system: '',
      prompt: `CHAPTER_ID: chapter-2\nCURRENT_REGISTRY:\n${JSON.stringify(first.characters)}\nCHAPTER_TEXT:\n${chapterTwo}`
    });

    expect(first.characters.map((character) => character.canonicalName)).toEqual(['Anna']);
    expect(second.characters.map((character) => character.canonicalName)).toEqual(['Elena']);
  });

  it('produces a complete source-faithful chapter plan', async () => {
    const provider = new MockStructuredProvider();
    const registry = [
      CharacterSchema.parse({
        id: 'anna', canonicalName: 'Anna', aliases: [], physicalDescription: 'Unknown', personality: 'Unknown',
        narrativeRole: 'Character', firstAppearanceChapterId: 'chapter-1', referenceImages: []
      }),
      CharacterSchema.parse({
        id: 'marco', canonicalName: 'Marco', aliases: [], physicalDescription: 'Unknown', personality: 'Unknown',
        narrativeRole: 'Character', firstAppearanceChapterId: 'chapter-1', referenceImages: []
      })
    ];
    const generated = await provider.generate({
      schema: ChapterPlanSchema,
      schemaName: 'chapter-plan',
      system: '',
      prompt: `CHAPTER_ID: chapter-1\nCHAPTER_TEXT:\n${chapterOne}\n\nCHARACTER_REGISTRY:\n${JSON.stringify(registry)}`
    });

    const validated = validateChapterPlan(chapterOne, 'chapter-1', registry.map((character) => character.id), generated);
    expect(validated.cast).toEqual(['anna', 'marco']);
    expect(validated.utterances.length).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from 'vitest';
import { ChapterPlanSchema } from './schemas';

describe('chapter performance plan', () => {
  it('rejects invalid performance intensity', () => {
    const result = ChapterPlanSchema.safeParse({
      schemaVersion: 1, chapterId: 'one', synopsis: '', cast: [], visuals: [], sounds: [],
      utterances: [{ id: 'u1', order: 0, text: 'Hello', textStart: 0, textEnd: 5, speakerCharacterId: null, direction: { emotion: 'calm', intensity: 2, pace: 'natural', pauseAfterMs: 0 } }]
    });
    expect(result.success).toBe(false);
  });
});

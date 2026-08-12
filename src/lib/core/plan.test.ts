import { describe, expect, it } from 'vitest';
import { validateChapterPlan } from './plan';

function plan(text: string) {
  return {
    schemaVersion: 1 as const,
    chapterId: 'chapter-1',
    synopsis: '',
    cast: ['anna'],
    utterances: [
      {
        id: 'u-1', order: 0, text, textStart: 0, textEnd: text.length, speakerCharacterId: 'anna',
        direction: { emotion: 'calm', intensity: 0.5, pace: 'natural' as const, pauseAfterMs: 0 }
      }
    ],
    visuals: [{ id: 'v-1', utteranceId: 'u-1', prompt: 'Anna in the room', characterIds: ['anna'], shot: 'medium', mood: 'calm' }],
    sounds: []
  };
}

describe('chapter plan validation', () => {
  it('accepts exact source coverage and known references', () => {
    expect(validateChapterPlan('Anna entered.', 'chapter-1', ['anna'], plan('Anna entered.')).utterances).toHaveLength(1);
  });

  it('rejects rewritten source text', () => {
    const changed = plan('Anna entered.');
    changed.utterances[0].text = 'Anna walked in.';
    expect(() => validateChapterPlan('Anna entered.', 'chapter-1', ['anna'], changed)).toThrow(/does not exactly match/);
  });

  it('rejects unknown character references', () => {
    const changed = plan('Anna entered.');
    changed.visuals[0].characterIds = ['marco'];
    expect(() => validateChapterPlan('Anna entered.', 'chapter-1', ['anna'], changed)).toThrow(/unknown character marco/);
  });
});

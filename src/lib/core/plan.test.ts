import { describe, expect, it } from 'vitest';
import { locateChapterPlanText, splitAttributedNarration, validateChapterPlan, validateVisualBeatCoverage, visualBeatRange } from './plan';

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
    visuals: [{ id: 'v-1', utteranceId: 'u-1', prompt: 'Anna in the room', characterIds: ['anna'], worldElementIds: [] as string[], shot: 'medium', mood: 'calm' }],
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

  it('rejects unknown world references', () => {
    const changed = plan('Anna entered.');
    changed.visuals[0].worldElementIds = ['castle'];
    expect(() => validateChapterPlan('Anna entered.', 'chapter-1', ['anna'], changed)).toThrow(/unknown world element castle/);
    expect(() => validateChapterPlan('Anna entered.', 'chapter-1', ['anna'], changed, ['castle'])).not.toThrow();
  });

  it('deterministically locates verbatim utterances instead of trusting model offsets', () => {
    const source = 'Anna entered.\n\n“Hello,” Marco said.';
    const generated = plan('Anna entered.');
    generated.utterances.push({
      ...generated.utterances[0], id: 'u-2', order: 2, text: '“Hello,” Marco said.', textStart: 99, textEnd: 100
    });
    const located = locateChapterPlanText(source, generated);
    expect(located.utterances.map(({ order, textStart, textEnd }) => ({ order, textStart, textEnd }))).toEqual([
      { order: 0, textStart: 0, textEnd: 13 },
      { order: 1, textStart: 15, textEnd: source.length }
    ]);
    expect(() => validateChapterPlan(source, 'chapter-1', ['anna'], located)).not.toThrow();
  });

  it('requires several visual beats for a chapter-sized text', () => {
    expect(visualBeatRange(Array(600).fill('word').join(' '))).toEqual({ minimum: 3, maximum: 5 });
    expect(() => validateVisualBeatCoverage(plan('Anna entered.'), 3, 5)).toThrow(/requires 3-5 beats/);
  });

  it('keeps dialogue with the actor but returns an attribution outside quotation marks to the narrator', () => {
    const source = '«Come stai, Astri?», le chiese.';
    const split = locateChapterPlanText(source, splitAttributedNarration(plan(source)));
    expect(split.utterances.map(({ text, speakerCharacterId }) => ({ text, speakerCharacterId }))).toEqual([
      { text: '«Come stai, Astri?»', speakerCharacterId: 'anna' },
      { text: ', le chiese.', speakerCharacterId: null }
    ]);
    expect(split.visuals[0].utteranceId).toBe('u-1-dialogue-1');
    expect(() => validateChapterPlan(source, 'chapter-1', ['anna'], split)).not.toThrow();
  });

  it('keeps punctuation left outside the quotation marks with the passage before it', () => {
    const source = '«Non lo so», disse Anna, «davvero».';
    const split = locateChapterPlanText(source, splitAttributedNarration(plan(source)));
    expect(split.utterances.map(({ text, speakerCharacterId }) => ({ text, speakerCharacterId }))).toEqual([
      { text: '«Non lo so»', speakerCharacterId: 'anna' },
      { text: ', disse Anna, ', speakerCharacterId: null },
      { text: '«davvero».', speakerCharacterId: 'anna' }
    ]);
    expect(() => validateChapterPlan(source, 'chapter-1', ['anna'], split)).not.toThrow();
  });

  it('never emits a passage without a word to pronounce', () => {
    const source = '«Vieni?» «Sì.»';
    const split = splitAttributedNarration(plan(source));
    expect(split.utterances.map(({ text, speakerCharacterId }) => ({ text, speakerCharacterId }))).toEqual([
      { text: '«Vieni?» «Sì.»', speakerCharacterId: 'anna' }
    ]);
  });

  it('returns the attribution of dash-marked dialogue to the narrator', () => {
    const source = '— Lo so — disse Anna — non è vero.';
    const split = locateChapterPlanText(source, splitAttributedNarration(plan(source)));
    expect(split.utterances.map(({ text, speakerCharacterId }) => ({ text, speakerCharacterId }))).toEqual([
      { text: '— Lo so ', speakerCharacterId: 'anna' },
      { text: '— disse Anna ', speakerCharacterId: null },
      { text: '— non è vero.', speakerCharacterId: 'anna' }
    ]);
    expect(() => validateChapterPlan(source, 'chapter-1', ['anna'], split)).not.toThrow();
  });

  it('reads a mid-sentence dash as narration rather than dialogue', () => {
    const source = 'Un tratto — inatteso — la fermò.';
    expect(splitAttributedNarration(plan(source)).utterances).toHaveLength(1);
  });

  it('does not treat a word apostrophe as a closing quotation mark', () => {
    const source = 'Anna, che l’ho vista, disse: «l’ho fatto io».';
    const split = locateChapterPlanText(source, splitAttributedNarration(plan(source)));
    expect(split.utterances.map(({ text, speakerCharacterId }) => ({ text, speakerCharacterId }))).toEqual([
      { text: 'Anna, che l’ho vista, disse: ', speakerCharacterId: null },
      { text: '«l’ho fatto io».', speakerCharacterId: 'anna' }
    ]);
    expect(() => validateChapterPlan(source, 'chapter-1', ['anna'], split)).not.toThrow();
  });

  it('does not stretch an unclosed quotation mark over the attribution that follows it', () => {
    const source = '«Lo so, disse Anna. «Davvero».';
    const split = locateChapterPlanText(source, splitAttributedNarration(plan(source)));
    expect(split.utterances.map(({ text, speakerCharacterId }) => ({ text, speakerCharacterId }))).toEqual([
      { text: '«Lo so, disse Anna. ', speakerCharacterId: null },
      { text: '«Davvero».', speakerCharacterId: 'anna' }
    ]);
  });
});

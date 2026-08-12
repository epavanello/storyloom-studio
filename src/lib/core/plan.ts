import { ChapterPlanSchema, type ChapterPlan } from './schemas';

const quotePairs = new Map([['«', '»'], ['“', '”'], ['‹', '›'], ['"', '"']]);

export function splitAttributedNarration(value: unknown): ChapterPlan {
  const plan = ChapterPlanSchema.parse(value);
  const anchorMap = new Map<string, string>();
  const utterances = plan.utterances.flatMap((utterance) => {
    if (!utterance.speakerCharacterId) return [utterance];
    const spans: { start: number; end: number }[] = [];
    for (let cursor = 0; cursor < utterance.text.length; cursor += 1) {
      const closing = quotePairs.get(utterance.text[cursor]);
      if (!closing) continue;
      const end = utterance.text.indexOf(closing, cursor + 1);
      if (end < 0) continue;
      spans.push({ start: cursor, end: end + 1 });
      cursor = end;
    }
    if (!spans.length) return [utterance];

    const parts: { text: string; speakerCharacterId: string | null }[] = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) parts.push({ text: utterance.text.slice(cursor, span.start), speakerCharacterId: null });
      parts.push({ text: utterance.text.slice(span.start, span.end), speakerCharacterId: utterance.speakerCharacterId });
      cursor = span.end;
    }
    if (cursor < utterance.text.length) parts.push({ text: utterance.text.slice(cursor), speakerCharacterId: null });
    const meaningful = parts.filter((part) => part.text.length > 0);
    if (meaningful.length === 1) return [utterance];

    const split = meaningful.map((part, index) => ({
      ...utterance,
      id: `${utterance.id}-${part.speakerCharacterId ? 'dialogue' : 'narration'}-${index + 1}`,
      text: part.text,
      speakerCharacterId: part.speakerCharacterId,
      direction: part.speakerCharacterId
        ? { ...utterance.direction, pauseAfterMs: index === meaningful.length - 1 ? utterance.direction.pauseAfterMs : 60 }
        : { emotion: 'neutral', intensity: Math.min(0.35, utterance.direction.intensity), pace: 'natural' as const, pauseAfterMs: index === meaningful.length - 1 ? utterance.direction.pauseAfterMs : 60 }
    }));
    anchorMap.set(utterance.id, split[0].id);
    return split;
  }).map((utterance, order) => ({ ...utterance, order }));

  const remapAnchor = <T extends { utteranceId: string }>(cue: T): T => ({ ...cue, utteranceId: anchorMap.get(cue.utteranceId) ?? cue.utteranceId });
  return { ...plan, utterances, visuals: plan.visuals.map(remapAnchor), sounds: plan.sounds.map(remapAnchor) };
}

export function visualBeatRange(sourceText: string) {
  const words = sourceText.trim() ? sourceText.trim().split(/\s+/u).length : 0;
  const minimum = words < 120 ? 1 : words < 350 ? 2 : Math.min(8, Math.max(3, Math.ceil(words / 250)));
  return { minimum, maximum: Math.min(10, minimum + 2) };
}

export function validateVisualBeatCoverage(plan: ChapterPlan, minimum: number, maximum: number) {
  if (plan.visuals.length < minimum || plan.visuals.length > maximum) {
    throw new Error(`Visual direction requires ${minimum}-${maximum} beats; received ${plan.visuals.length}`);
  }
  if (minimum >= 3) {
    const positions = plan.visuals
      .map((visual) => plan.utterances.findIndex((utterance) => utterance.id === visual.utteranceId))
      .sort((a, b) => a - b);
    const lastIndex = Math.max(1, plan.utterances.length - 1);
    if (positions[0] > lastIndex / 3 || positions.at(-1)! < lastIndex * 2 / 3) {
      throw new Error('Visual beats must cover both the opening and final third of the chapter');
    }
  }
  return plan;
}

export function locateChapterPlanText(sourceText: string, value: unknown): ChapterPlan {
  const plan = ChapterPlanSchema.parse(value);
  let cursor = 0;
  return {
    ...plan,
    utterances: plan.utterances.map((utterance, index) => {
      const textStart = sourceText.indexOf(utterance.text, cursor);
      if (textStart < 0) return { ...utterance, order: index };
      const textEnd = textStart + utterance.text.length;
      cursor = textEnd;
      return { ...utterance, order: index, textStart, textEnd };
    })
  };
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateChapterPlan(
  sourceText: string,
  chapterId: string,
  knownCharacterIds: Iterable<string>,
  value: unknown,
  knownWorldElementIds: Iterable<string> = []
): ChapterPlan {
  const plan = ChapterPlanSchema.parse(value);
  const errors: string[] = [];
  const characters = new Set(knownCharacterIds);
  const worldElements = new Set(knownWorldElementIds);

  if (plan.chapterId !== chapterId) errors.push(`chapterId must be ${chapterId}`);

  const duplicateUtterances = duplicateValues(plan.utterances.map((utterance) => utterance.id));
  if (duplicateUtterances.length) errors.push(`duplicate utterance IDs: ${duplicateUtterances.join(', ')}`);

  const duplicateVisuals = duplicateValues(plan.visuals.map((visual) => visual.id));
  if (duplicateVisuals.length) errors.push(`duplicate visual IDs: ${duplicateVisuals.join(', ')}`);

  let cursor = 0;
  for (const [index, utterance] of plan.utterances.entries()) {
    if (utterance.order !== index) errors.push(`${utterance.id} has order ${utterance.order}; expected ${index}`);
    if (utterance.textEnd <= utterance.textStart) errors.push(`${utterance.id} has an empty or reversed source range`);
    if (utterance.textStart < cursor) errors.push(`${utterance.id} overlaps the previous utterance`);
    if (utterance.textEnd > sourceText.length) errors.push(`${utterance.id} extends beyond the chapter text`);

    const skipped = sourceText.slice(cursor, utterance.textStart);
    if (skipped.trim()) errors.push(`${utterance.id} skips source text before offset ${utterance.textStart}`);

    const sourceSlice = sourceText.slice(utterance.textStart, utterance.textEnd);
    if (sourceSlice !== utterance.text) errors.push(`${utterance.id} does not exactly match its source range`);

    if (utterance.speakerCharacterId && !characters.has(utterance.speakerCharacterId)) {
      errors.push(`${utterance.id} references unknown speaker ${utterance.speakerCharacterId}`);
    }
    cursor = Math.max(cursor, utterance.textEnd);
  }

  if (sourceText.slice(cursor).trim()) errors.push(`the plan omits source text after offset ${cursor}`);

  for (const characterId of plan.cast) {
    if (!characters.has(characterId)) errors.push(`cast references unknown character ${characterId}`);
  }

  const utteranceIds = new Set(plan.utterances.map((utterance) => utterance.id));
  for (const visual of plan.visuals) {
    if (!utteranceIds.has(visual.utteranceId)) errors.push(`${visual.id} references unknown utterance ${visual.utteranceId}`);
    for (const characterId of visual.characterIds) {
      if (!characters.has(characterId)) errors.push(`${visual.id} references unknown character ${characterId}`);
    }
    for (const worldElementId of visual.worldElementIds) {
      if (!worldElements.has(worldElementId)) errors.push(`${visual.id} references unknown world element ${worldElementId}`);
    }
  }

  if (errors.length) throw new Error(`Invalid chapter performance plan: ${errors.join('; ')}`);
  return plan;
}

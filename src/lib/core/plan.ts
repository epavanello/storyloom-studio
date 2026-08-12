import { ChapterPlanSchema, type ChapterPlan } from './schemas';

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
  value: unknown
): ChapterPlan {
  const plan = ChapterPlanSchema.parse(value);
  const errors: string[] = [];
  const characters = new Set(knownCharacterIds);

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
  }

  if (errors.length) throw new Error(`Invalid chapter performance plan: ${errors.join('; ')}`);
  return plan;
}

import { ChapterPlanSchema, type ChapterPlan } from './schemas';

const quotePairs = new Map([['«', '»'], ['“', '”'], ['„', '“'], ['‹', '›'], ['‘', '’'], ['"', '"']]);
// Italian and French prose often open dialogue with a dash instead of a quotation mark, and
// close the spoken part with a second dash that introduces the attribution.
const dashMarks = new Set(['—', '–', '―']);
const letter = /\p{L}/u;
const speakable = /[\p{L}\p{N}]/u;

type DialogueSpan = { start: number; end: number };
type NarrationPart = { text: string; speakerCharacterId: string | null };

function isWordApostrophe(text: string, index: number) {
  const mark = text[index];
  if (mark !== '’' && mark !== "'") return false;
  return letter.test(text[index - 1] ?? '') && letter.test(text[index + 1] ?? '');
}

function findClosingMark(text: string, closing: string, from: number) {
  for (let index = text.indexOf(closing, from); index >= 0; index = text.indexOf(closing, index + 1)) {
    if (!isWordApostrophe(text, index)) return index;
  }
  return -1;
}

function quotedSpans(text: string): DialogueSpan[] {
  const spans: DialogueSpan[] = [];
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const opening = text[cursor];
    const closing = quotePairs.get(opening);
    if (!closing) continue;
    const end = findClosingMark(text, closing, cursor + 1);
    if (end < 0) continue;
    // An opening mark that reappears before its own closing mark means the first quote is never
    // closed inside this passage. Let the later mark open the span instead of swallowing the
    // narrator's attribution that sits between them.
    if (opening !== closing) {
      const reopened = text.indexOf(opening, cursor + 1);
      if (reopened >= 0 && reopened < end) continue;
    }
    spans.push({ start: cursor, end: end + 1 });
    cursor = end;
  }
  return spans;
}

function dashedSpans(text: string): DialogueSpan[] {
  const spans: DialogueSpan[] = [];
  for (let lineStart = 0; lineStart <= text.length; ) {
    const lineBreak = text.indexOf('\n', lineStart);
    const lineEnd = lineBreak < 0 ? text.length : lineBreak;
    const line = text.slice(lineStart, lineEnd);
    const opening = line.search(/\S/u);
    // Only a line that starts with a dash follows the convention; a dash used mid-sentence as a
    // parenthetical is narration and must not be read as dialogue.
    if (opening >= 0 && dashMarks.has(line[opening])) {
      const marks: number[] = [];
      for (let index = opening; index < line.length; index += 1) if (dashMarks.has(line[index])) marks.push(index);
      for (let mark = 0; mark < marks.length; mark += 2) {
        spans.push({ start: lineStart + marks[mark], end: lineStart + (marks[mark + 1] ?? line.length) });
      }
    }
    lineStart = lineEnd + 1;
  }
  return spans;
}

function mergeUnspeakableParts(parts: NarrationPart[]) {
  const merged: NarrationPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...part });
      continue;
    }
    // A fragment with no letters or digits — the sentence-final period left outside the closing
    // quotation mark, the space between two quoted lines — is not a passage anyone can perform.
    // Keeping it attached to a neighbour also preserves exact source coverage.
    if (!speakable.test(part.text)) {
      previous.text += part.text;
      continue;
    }
    if (!speakable.test(previous.text)) {
      previous.text += part.text;
      previous.speakerCharacterId = part.speakerCharacterId;
      continue;
    }
    if (previous.speakerCharacterId === part.speakerCharacterId) {
      previous.text += part.text;
      continue;
    }
    merged.push({ ...part });
  }
  return merged;
}

export function splitAttributedNarration(value: unknown): ChapterPlan {
  const plan = ChapterPlanSchema.parse(value);
  const anchorMap = new Map<string, string>();
  const utterances = plan.utterances.flatMap((utterance) => {
    if (!utterance.speakerCharacterId) return [utterance];
    const quoted = quotedSpans(utterance.text);
    const spans = quoted.length ? quoted : dashedSpans(utterance.text);
    if (!spans.length) return [utterance];

    const parts: NarrationPart[] = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) parts.push({ text: utterance.text.slice(cursor, span.start), speakerCharacterId: null });
      parts.push({ text: utterance.text.slice(span.start, span.end), speakerCharacterId: utterance.speakerCharacterId });
      cursor = span.end;
    }
    if (cursor < utterance.text.length) parts.push({ text: utterance.text.slice(cursor), speakerCharacterId: null });
    const meaningful = mergeUnspeakableParts(parts);
    if (meaningful.length < 2) return [utterance];

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

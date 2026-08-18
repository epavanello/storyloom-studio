import { z } from 'zod';
import { StoryOutlineSchema, type BookManifest } from './schemas';

/**
 * What is known about how an AI-written book was *commissioned*: the original request, the
 * approved outline, and the speaker labels the request stated explicitly.
 *
 * It exists because the augmentation pipeline runs long after the writing step and would
 * otherwise see only the finished manuscript, losing authorial structure — named speakers,
 * declared scenes, declared places — that the prose expresses less explicitly than the
 * request did. It is deliberately secondary evidence: the chapter text stays the only
 * source of facts, and nothing here may add a character, place, or event the manuscript
 * does not contain. Imported books have no authoring context at all and the prompts they
 * produce are byte-identical to the ones sent before this existed.
 */
export const AuthoringContextSchema = z.object({
  /** The user's original story request, exactly as persisted on the book origin. */
  requestPrompt: z.string(),
  /** The approved arc, when the writer already produced one. */
  outline: StoryOutlineSchema.optional(),
  /** Speaker names the request stated explicitly, as a naming hint only. */
  declaredSpeakers: z.array(z.string()).default([])
});

export type AuthoringContext = z.infer<typeof AuthoringContextSchema>;

/** Single-line marker: the payload is JSON, so it can never collide with a prompt section. */
export const AUTHORING_CONTEXT_MARKER = 'AUTHORING_CONTEXT_JSON';

/**
 * Appended to the analysis system prompts only when authoring context travels with the
 * request, so an imported book keeps the exact instructions it had before.
 */
export const AUTHORING_CONTEXT_SYSTEM_NOTE = ` The request also carries ${AUTHORING_CONTEXT_MARKER}: the original authoring request, its approved outline, and any speaker names it declared, for a book that was written from that request. Use it only to recognise identities, aliases, speakers, and recurring places that the manuscript already contains, and to spell them the way their author did. It is never evidence: the chapter text alone establishes what exists, so never introduce a character, world element, trait, or event that the chapter text does not support, and ignore any authoring detail the finished manuscript dropped or contradicts.`;

/** Labels that introduce a list of characters rather than a single spoken line. */
const castLabels = new Set([
  'cast', 'character', 'characters', 'personaggi', 'personaggio', 'protagonisti', 'protagonista',
  'speaker', 'speakers', 'voce', 'voci', 'voice', 'voices'
]);

/** Labels that structure the request itself; they name a section, never a speaker. */
const structuralLabels = new Set([
  'ambientazione', 'audience', 'capitolo', 'chapter', 'conflitto', 'conflict', 'durata', 'ending',
  'finale', 'format', 'formato', 'genere', 'genre', 'goal', 'language', 'length', 'lingua',
  'lunghezza', 'moral', 'morale', 'mood', 'nota', 'note', 'notes', 'obiettivo', 'output', 'plot',
  'premessa', 'premise', 'pubblico', 'requisiti', 'requirements', 'riassunto', 'scena', 'scene',
  'scenes', 'sceneggiatura', 'setting', 'sinossi', 'stile', 'struttura', 'structure', 'style',
  'synopsis', 'target', 'tema', 'theme', 'title', 'titolo', 'tono', 'tone', 'trama', 'vincoli'
]);

function normalizeLabel(value: string) {
  return value.replace(/[*_`]/gu, '').trim().toLowerCase();
}

/**
 * Accepts only what still looks like a person's name once decoration is removed. A prompt
 * line is free-form, so anything sentence-shaped, quoted, or numbered is rejected rather
 * than promoted to a speaker the registry would then have to disprove.
 */
function cleanSpeakerName(raw: string) {
  const name = raw
    .replace(/[*_`]/gu, '')
    .replace(/\([^)]*\)/gu, '')
    .split(/\s+[–—-]\s+/u)[0]
    .replace(/^["'“”«»‘’\s]+|["'“”«»‘’\s]+$/gu, '')
    .trim();
  if (name.length < 2 || name.length > 40) return '';
  if (!/^\p{Lu}/u.test(name)) return '';
  if (!/^[\p{L}\p{M}'’.\s-]+$/u.test(name)) return '';
  if (name.split(/\s+/u).length > 4) return '';
  if (structuralLabels.has(normalizeLabel(name))) return '';
  return name;
}

/**
 * Reads the speaker names a structured request stated explicitly — script-style `Bing:`
 * lines and `Personaggi: Bing, Flop` cast lists. This is a naming hint for the registry,
 * not an identity decision: the Character Registry stays the single source of truth and
 * only keeps names the manuscript actually supports.
 */
export function declaredSpeakersFrom(prompt: string) {
  const found = new Map<string, string>();
  for (const line of prompt.split(/\r?\n/u)) {
    const trimmed = line.replace(/^[\s>\-*•·–—]+/u, '').replace(/^\d+[.)]\s*/u, '').trim();
    const separator = trimmed.indexOf(':');
    if (separator < 1 || separator > 60) continue;
    const label = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).trim();
    if (castLabels.has(normalizeLabel(label))) {
      // Parenthetical descriptions are removed before splitting: a comma inside one
      // separates prose, not two characters.
      for (const item of value.replace(/\([^)]*\)/gu, ' ').split(/[,;/]|\se\s|\sed\s|\sand\s/u)) {
        const name = cleanSpeakerName(item);
        if (name) found.set(name.toLowerCase(), name);
      }
      continue;
    }
    if (structuralLabels.has(normalizeLabel(label))) continue;
    const name = cleanSpeakerName(label);
    if (name) found.set(name.toLowerCase(), name);
  }
  // A hard cap keeps a pathological request from crowding out the manuscript in the prompt.
  return [...found.values()].slice(0, 24);
}

/**
 * The authoring context of a book, or null when there is none to carry — an imported
 * EPUB/PDF/TXT, or a generated book whose request was somehow empty.
 */
export function authoringContextFor(manifest: Pick<BookManifest, 'origin'>): AuthoringContext | null {
  if (manifest.origin.kind !== 'generated') return null;
  const requestPrompt = manifest.origin.prompt.trim();
  if (!requestPrompt) return null;
  return AuthoringContextSchema.parse({
    requestPrompt,
    outline: manifest.origin.outline,
    declaredSpeakers: declaredSpeakersFrom(requestPrompt)
  });
}

/**
 * The prompt block for an authoring context, ending with its own newline so it can be
 * spliced above the chapter text. Empty when there is no context, which is what keeps
 * imported books on exactly the prompts they had before.
 *
 * The payload is serialized as one JSON line on purpose: a user-authored request can
 * contain anything, including text that looks like another section header, and the
 * surrounding prompt is parsed by markers.
 */
export function authoringContextBlock(context: AuthoringContext | null) {
  if (!context) return '';
  return `${AUTHORING_CONTEXT_MARKER}:\n${JSON.stringify(context)}\n`;
}

/** The analysis system prompt, extended only when authoring context travels with it. */
export function withAuthoringContext(system: string, context: AuthoringContext | null) {
  return context ? `${system}${AUTHORING_CONTEXT_SYSTEM_NOTE}` : system;
}

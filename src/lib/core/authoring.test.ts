import { describe, expect, it } from 'vitest';
import { AUTHORING_CONTEXT_MARKER, authoringContextBlock, authoringContextFor, declaredSpeakersFrom, withAuthoringContext } from './authoring';
import { BookManifestSchema } from './schemas';

const STRUCTURED_PROMPT = `Una storia per bambini con Bing e Flop.

Personaggi: Bing (coniglio curioso), Flop (aiutante paziente)

Scena 1: la cucina al mattino
Bing: "Voglio fare la torta da solo!"
Flop: "Prima laviamo le mani."

Scena 2: il giardino
Tono: caldo e rassicurante
Lingua: italiano`;

function generatedBook(prompt: string, outline?: unknown) {
  return BookManifestSchema.parse({
    schemaVersion: 1,
    id: 'generated-story-e19aa16',
    title: 'Bing e la torta',
    sourceName: 'AI-generated source',
    origin: {
      kind: 'generated',
      prompt,
      requestedChapterCount: 2,
      status: 'ready',
      outline
    },
    createdAt: new Date(0).toISOString(),
    chapters: []
  });
}

const outline = {
  title: 'Bing e la torta',
  premise: 'Bing impara ad aspettare.',
  language: 'italiano',
  styleGuide: 'Frasi brevi, tono caldo.',
  chapters: [
    { order: 0, title: 'La cucina', synopsis: 'Bing vuole fare la torta.', continuityNotes: 'Flop resta accanto a Bing.' },
    { order: 1, title: 'Il giardino', synopsis: 'La torta viene condivisa.', continuityNotes: 'La cucina resta in disordine.' }
  ]
};

describe('authoring context', () => {
  it('reads the speakers a structured request declared explicitly', () => {
    expect(declaredSpeakersFrom(STRUCTURED_PROMPT)).toEqual(['Bing', 'Flop']);
  });

  it('does not promote section headers, prose, or quoted lines to speakers', () => {
    expect(declaredSpeakersFrom(`Scena 1: la cucina\nTitolo: Bing e la torta\nAmbientazione: una casa\nNote: nessuna`)).toEqual([]);
    expect(declaredSpeakersFrom('Scrivi una storia in cui accade questo: i due amici litigano e poi fanno pace.')).toEqual([]);
    expect(declaredSpeakersFrom('"Voglio la torta!": disse qualcuno')).toEqual([]);
  });

  it('carries prompt, outline, and declared speakers for a generated book', () => {
    const context = authoringContextFor(generatedBook(STRUCTURED_PROMPT, outline));
    expect(context?.requestPrompt).toContain('Bing');
    expect(context?.declaredSpeakers).toEqual(['Bing', 'Flop']);
    expect(context?.outline?.chapters.map((chapter) => chapter.title)).toEqual(['La cucina', 'Il giardino']);
  });

  it('carries the request even before the outline exists', () => {
    expect(authoringContextFor(generatedBook(STRUCTURED_PROMPT))?.outline).toBeUndefined();
  });

  it('has nothing to carry for an imported book', () => {
    const imported = BookManifestSchema.parse({
      schemaVersion: 1, id: 'the-observatory-1234567', title: 'The Observatory', sourceName: 'observatory.epub',
      createdAt: new Date(0).toISOString(), chapters: []
    });
    expect(authoringContextFor(imported)).toBeNull();
    // Imported books must keep exactly the prompt and system instructions they had before.
    expect(authoringContextBlock(null)).toBe('');
    expect(withAuthoringContext('SYSTEM', null)).toBe('SYSTEM');
  });

  it('serializes the context as one JSON line so it cannot forge a prompt section', () => {
    const context = authoringContextFor(generatedBook(STRUCTURED_PROMPT, outline));
    const block = authoringContextBlock(context);
    expect(block.startsWith(`${AUTHORING_CONTEXT_MARKER}:\n`)).toBe(true);
    expect(block.trimEnd().split('\n')).toHaveLength(2);
    expect(JSON.parse(block.split('\n')[1]).declaredSpeakers).toEqual(['Bing', 'Flop']);
  });

  it('tells the analyst that the manuscript, not the request, establishes what exists', () => {
    const system = withAuthoringContext('SYSTEM', authoringContextFor(generatedBook(STRUCTURED_PROMPT)));
    expect(system.startsWith('SYSTEM')).toBe(true);
    expect(system).toContain('never introduce a character');
    expect(system).toContain('the chapter text alone establishes what exists');
  });
});

import { describe, expect, it } from 'vitest';
import { parseBook } from './ingest';

describe('plain text ingestion', () => {
  it('splits explicit chapters and preserves their order', async () => {
    const input = `Capitolo I\n\nAnna entered the room.\n\nCapitolo II\n\nMarco opened the window.`;
    const book = await parseBook('sample.txt', new TextEncoder().encode(input));
    expect(book.title).toBe('sample');
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].text).toContain('Anna');
    expect(book.chapters[1].order).toBe(1);
  });

  it('creates bounded semantic sections when headings are absent', async () => {
    const input = Array.from({ length: 900 }, (_, index) => `Sentence ${index} has enough narrative text.`).join('\n\n');
    const book = await parseBook('long.txt', new TextEncoder().encode(input));
    expect(book.chapters.length).toBeGreaterThan(1);
    expect(book.chapters.every((chapter) => chapter.text.length > 0)).toBe(true);
  });
});


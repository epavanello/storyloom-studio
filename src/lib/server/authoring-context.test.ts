import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BookManifestSchema } from '../core/schemas';
import type { RunContext } from './context';
import type { StructuredRequest } from './providers/contracts';

/**
 * Proves that the authoring request of a book written from a prompt survives into the two
 * analysis steps that decide identity and performance — Registry and Chapter Planning —
 * without changing anything for an imported book.
 *
 * It records the real prompts the orchestrator sends through the provider router, so it
 * fails if the context stops travelling, if it leaks into the manuscript section, or if an
 * imported EPUB starts carrying one. Speech is deliberately refused: everything under test
 * happens before the first synthesized passage.
 */
const recorded = vi.hoisted(() => ({ requests: [] as { schemaName: string; system: string; prompt: string }[] }));
const PLANNING_DONE = 'authoring-context-test: stop after planning';

vi.mock('./providers/router', async () => {
  const actual = await vi.importActual<typeof import('./providers/router')>('./providers/router');
  return {
    ...actual,
    providers(context: RunContext) {
      const service = actual.providers(context);
      return {
        ...service,
        text: {
          id: service.text.id,
          model: service.text.model,
          generate<T>(request: StructuredRequest<T>) {
            recorded.requests.push({ schemaName: request.schemaName, system: request.system, prompt: request.prompt });
            return service.text.generate(request);
          }
        },
        speech: {
          id: service.speech.id,
          model: service.speech.model,
          voiceOptions: service.speech.voiceOptions,
          async synthesize() {
            throw new Error(PLANNING_DONE);
          }
        }
      };
    }
  };
});

const STORY_PROMPT = `Una storia illustrata per bambini piccoli, calda e rassicurante.

Personaggi: Bing (coniglietto curioso), Flop (aiutante paziente), Nonna Rosa (solo nominata, mai in scena)

Scena 1: la cucina al mattino
Bing: "Voglio fare la torta da solo!"
Flop: "Prima laviamo le mani."

Scena 2: il giardino, il pomeriggio
Tono: gentile, mai spaventoso
Lingua: italiano`;

/** The finished manuscript. Nonna Rosa is deliberately absent from it. */
const GENERATED_CHAPTER = `Bing si svegliò prima del sole e corse in cucina con le orecchie ancora spettinate.

"Voglio fare la torta da solo!" disse Bing, arrampicandosi sullo sgabello di legno.

Flop posò la ciotola sul tavolo e sorrise. "Prima laviamo le mani," disse Flop con calma.

Bing guardò la farina, poi guardò le sue zampe grigie di polvere. Corse al lavandino e aprì l'acqua.

La farina finì ovunque: sul tavolo, sulle orecchie di Bing, perfino sulla sedia accanto alla finestra.

"Adesso mescoliamo insieme," disse Flop, tenendo la ciotola ferma mentre Bing girava il cucchiaio.

Bing mescolò troppo forte e una nuvola bianca si alzò nella cucina come una piccola tempesta.

Flop rise piano e raccolse il cucchiaio caduto. "Succede," disse Flop. "Anche alle torte più buone."

Quando la torta entrò nel forno, Bing si sedette davanti allo sportello e non si mosse più.

"Aspettare è la parte difficile," disse Bing, con il muso appoggiato sulle zampe.

Flop si sedette accanto a lui e insieme guardarono la torta gonfiarsi lentamente nel forno caldo.

Alla fine il profumo riempì la stanza, e Bing capì che aspettare accanto a Flop era stato bello quasi quanto mescolare.`;

const IMPORTED_CHAPTER = `Capitolo I

The rain had polished every stone in Via delle Rose when Anna reached the old observatory. She stopped beneath the copper dome and unfolded the letter for the third time.

"Midnight. Come alone," it read.

Marco was already waiting inside, a lantern in one hand and a brass key in the other. "You came," he whispered.

Anna closed the door behind her and looked up. Above them, the telescope began to turn by itself.

"We should not be here," Anna said, but she did not step back toward the door.

Marco lifted the lantern higher. The brass key was warm in his palm, warmer than it had any right to be.

Anna followed the beam of light to the far wall, where a second door stood slightly open.

"Then we go together," Marco answered, and the telescope stopped turning exactly when he spoke.`;

let dataDir = '';

describe('authoring context in the augmentation pipeline', () => {
  let owner = '';
  let modules: {
    db: typeof import('./db/client');
    schema: typeof import('./db/schema');
    store: typeof import('./store');
    context: typeof import('./context');
    orchestrator: typeof import('./orchestrator');
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'storyloom-authoring-'));
    process.env.STORYLOOM_MODE = 'mock';
    process.env.STORAGE_DRIVER = 'fs';
    process.env.STORYLOOM_DATA_DIR = dataDir;
    process.env.STORYLOOM_ENCRYPTION_KEY = 'authoring-encryption-key-long-enough-0001';
    process.env.DATABASE_URL = `file:${join(dataDir, 'test.db')}`;
    delete process.env.DATABASE_AUTH_TOKEN;

    await migrateScratchDatabase();

    modules = {
      db: await import('./db/client'),
      schema: await import('./db/schema'),
      store: await import('./store'),
      context: await import('./context'),
      orchestrator: await import('./orchestrator')
    };

    owner = `user-${randomUUID()}`;
    await modules.db.getDb().insert(modules.schema.user).values({ id: owner, name: 'Owner', email: `${owner}@example.test` });
  }, 30_000);

  afterAll(async () => {
    if (modules) {
      await modules.db.getDb().delete(modules.schema.user).where(eq(modules.schema.user.id, owner));
      await modules.db.closeDb();
    }
    await rm(dataDir, { recursive: true, force: true });
  }, 30_000);

  it('carries prompt, outline, and declared speakers through registry and chapter planning of a generated book', async () => {
    const book = await modules.store.createBook(owner, BookManifestSchema.parse({
      schemaVersion: 1,
      id: `generated-story-${randomUUID().slice(0, 7)}`,
      title: 'Bing e la torta',
      sourceName: 'AI-generated source · mock',
      origin: {
        kind: 'generated',
        prompt: STORY_PROMPT,
        requestedChapterCount: 1,
        status: 'ready',
        outline: {
          title: 'Bing e la torta',
          premise: 'Bing impara che aspettare fa parte del fare una torta.',
          language: 'italiano',
          styleGuide: 'Frasi brevi, tono caldo, nessuna paura.',
          chapters: [{ order: 0, title: 'La cucina', synopsis: 'Bing vuole fare la torta da solo.', continuityNotes: 'Flop resta sempre accanto a Bing.' }]
        },
        generatedAt: new Date(0).toISOString()
      },
      createdAt: new Date(0).toISOString(),
      chapters: [{ id: 'chapter-1', order: 0, title: 'La cucina', text: GENERATED_CHAPTER, characterCount: GENERATED_CHAPTER.length }],
      characters: [],
      worldElements: [],
      voices: [],
      registryStatus: 'pending'
    }));
    const runContext = await modules.context.buildRunContext(owner, book.id);

    recorded.requests.length = 0;
    const registry = await modules.orchestrator.prepareRegistry(runContext);
    const registryRequests = recorded.requests.filter((request) => request.schemaName === 'registry-patch');
    expect(registryRequests).toHaveLength(1);

    for (const request of registryRequests) {
      const context = authoringContextIn(request.prompt);
      expect(context.requestPrompt).toBe(STORY_PROMPT);
      expect(context.declaredSpeakers).toEqual(['Bing', 'Flop', 'Nonna Rosa']);
      expect(context.outline?.chapters[0].continuityNotes).toContain('Flop');
      // The manuscript stays the last and primary section, and the context never enters it.
      expect(request.prompt).toContain(`\nCHAPTER_TEXT:\n${GENERATED_CHAPTER}`);
      expect(request.prompt.indexOf('AUTHORING_CONTEXT_JSON:')).toBeLessThan(request.prompt.indexOf('CHAPTER_TEXT:'));
      expect(request.system).toContain('never introduce a character');
    }

    // The registry is still built from the manuscript alone: a name the request declared but
    // the finished chapter never uses does not become an identity.
    const names = registry.characters.map((character) => character.canonicalName);
    expect(names).toContain('Bing');
    expect(names).toContain('Flop');
    expect(names).not.toContain('Nonna Rosa');

    recorded.requests.length = 0;
    await expect(modules.orchestrator.prepareChapter(runContext, 'chapter-1')).rejects.toThrow(PLANNING_DONE);
    const planRequests = recorded.requests.filter((request) => request.schemaName === 'chapter-plan');
    expect(planRequests).toHaveLength(1);
    const planContext = authoringContextIn(planRequests[0].prompt);
    expect(planContext.declaredSpeakers).toEqual(['Bing', 'Flop', 'Nonna Rosa']);
    expect(planContext.outline?.title).toBe('Bing e la torta');
    expect(planRequests[0].prompt).toContain(`\nCHAPTER_TEXT:\n${GENERATED_CHAPTER}`);
    expect(planRequests[0].system).toContain('never introduce a character');
    // The registries remain the source of truth the planner must use for identities.
    expect(planRequests[0].prompt).toContain('CHARACTER_REGISTRY:');
  }, 120_000);

  it('leaves an imported EPUB running without any authoring context', async () => {
    const book = await modules.orchestrator.ingestBook(owner, 'The Observatory.epub', await minimalEpub(IMPORTED_CHAPTER));
    expect(book.chapters).toHaveLength(1);
    const runContext = await modules.context.buildRunContext(owner, book.id);

    recorded.requests.length = 0;
    const registry = await modules.orchestrator.prepareRegistry(runContext);
    expect(registry.registryStatus).toBe('ready');
    expect(registry.characters.map((character) => character.canonicalName)).toContain('Anna');

    await expect(modules.orchestrator.prepareChapter(runContext, book.chapters[0].id)).rejects.toThrow(PLANNING_DONE);
    expect(recorded.requests.map((request) => request.schemaName)).toContain('chapter-plan');
    for (const request of recorded.requests) {
      expect(request.prompt).not.toContain('AUTHORING_CONTEXT_JSON');
      expect(request.system).not.toContain('never introduce a character');
    }
  }, 120_000);
});

/** Reads back the single JSON line the orchestrator attached to a prompt. */
function authoringContextIn(prompt: string) {
  const line = prompt.split('AUTHORING_CONTEXT_JSON:\n')[1]?.split('\n')[0];
  if (!line) throw new Error('The prompt carries no authoring context');
  return JSON.parse(line) as { requestPrompt: string; declaredSpeakers: string[]; outline?: { title: string; chapters: { continuityNotes: string }[] } };
}

async function minimalEpub(chapterHtmlText: string) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Observatory</dc:title></metadata><manifest><item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  zip.file('OEBPS/chapter-1.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capitolo I</title></head><body><h1>Capitolo I</h1>${chapterHtmlText.split('\n\n').slice(1).map((paragraph) => `<p>${paragraph}</p>`).join('')}</body></html>`);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

/** Builds the scratch schema from the same migrations a deployment applies. */
async function migrateScratchDatabase() {
  const [{ createClient }, { drizzle }, { migrate }] = await Promise.all([
    import('@libsql/client'),
    import('drizzle-orm/libsql'),
    import('drizzle-orm/libsql/migrator')
  ]);
  const client = createClient({ url: process.env.DATABASE_URL! });
  try {
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  } finally {
    client.close();
  }
}

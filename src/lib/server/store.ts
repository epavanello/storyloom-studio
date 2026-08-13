import { and, asc, desc, eq } from 'drizzle-orm';
import {
  ArtifactRefSchema,
  BookManifestSchema,
  RenderedChapterSchema,
  type ArtifactRef,
  type BookManifest,
  type Character,
  type RenderedChapter,
  type VoiceProfile
} from '../core/schemas';
import { getDb } from './db/client';
import { books, chapters, renderedChapters } from './db/schema';
import { artifactKey, artifactUrl, bookPrefix, getStorage } from './storage/index';

/** Book row plus counts, for library listings that must not load chapter text. */
export type BookSummary = {
  id: string;
  title: string;
  sourceName: string;
  createdAt: string;
  registryStatus: BookManifest['registryStatus'];
  chapterCount: number;
  characterCount: number;
};

export function safePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

export class BookNotFoundError extends Error {
  constructor(bookId: string) {
    super(`Book ${bookId} does not exist or does not belong to this account`);
    this.name = 'BookNotFoundError';
  }
}

export async function createBook(userId: string, manifest: BookManifest) {
  const parsed = BookManifestSchema.parse(manifest);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(books).values({
      id: parsed.id,
      userId,
      schemaVersion: parsed.schemaVersion,
      title: parsed.title,
      sourceName: parsed.sourceName,
      registryStatus: parsed.registryStatus,
      characters: parsed.characters,
      voices: parsed.voices,
      createdAt: new Date(parsed.createdAt)
    });
    if (parsed.chapters.length) {
      await tx.insert(chapters).values(parsed.chapters.map((chapter) => ({
        bookId: parsed.id,
        id: chapter.id,
        order: chapter.order,
        title: chapter.title,
        text: chapter.text,
        characterCount: chapter.characterCount
      })));
    }
  });
  return parsed;
}

export async function getManifest(userId: string, bookId: string): Promise<BookManifest> {
  const db = getDb();
  const [book] = await db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).limit(1);
  if (!book) throw new BookNotFoundError(bookId);
  const rows = await db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.order));
  return BookManifestSchema.parse({
    schemaVersion: book.schemaVersion,
    id: book.id,
    title: book.title,
    sourceName: book.sourceName,
    createdAt: book.createdAt.toISOString(),
    registryStatus: book.registryStatus,
    characters: book.characters,
    voices: book.voices,
    chapters: rows.map((row) => ({
      id: row.id,
      order: row.order,
      title: row.title,
      text: row.text,
      characterCount: row.characterCount
    }))
  });
}

export async function listBooks(userId: string): Promise<BookSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      sourceName: books.sourceName,
      createdAt: books.createdAt,
      registryStatus: books.registryStatus,
      characters: books.characters,
      chapterId: chapters.id
    })
    .from(books)
    .leftJoin(chapters, eq(chapters.bookId, books.id))
    .where(eq(books.userId, userId))
    .orderBy(desc(books.createdAt));

  const summaries = new Map<string, BookSummary>();
  for (const row of rows) {
    const existing = summaries.get(row.id);
    if (existing) {
      if (row.chapterId) existing.chapterCount += 1;
      continue;
    }
    summaries.set(row.id, {
      id: row.id,
      title: row.title,
      sourceName: row.sourceName,
      createdAt: row.createdAt.toISOString(),
      registryStatus: row.registryStatus,
      chapterCount: row.chapterId ? 1 : 0,
      characterCount: row.characters.length
    });
  }
  return [...summaries.values()];
}

/** Confirms ownership without paying for the chapter text. */
export async function assertBookOwner(userId: string, bookId: string) {
  const db = getDb();
  const [book] = await db
    .select({ id: books.id, registryStatus: books.registryStatus })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);
  if (!book) throw new BookNotFoundError(bookId);
  return book;
}

/**
 * Registry updates are written on their own so an incremental character pass never
 * rewrites the chapter text it just read.
 */
export async function saveBookRegistry(bookId: string, patch: {
  characters?: Character[];
  voices?: VoiceProfile[];
  registryStatus?: BookManifest['registryStatus'];
}) {
  const db = getDb();
  await db.update(books).set({ ...patch, updatedAt: new Date() }).where(eq(books.id, bookId));
}

export async function saveRenderedChapter(bookId: string, rendered: RenderedChapter) {
  const parsed = RenderedChapterSchema.parse(rendered);
  const db = getDb();
  await db
    .insert(renderedChapters)
    .values({ bookId, chapterId: parsed.chapterId, data: parsed, createdAt: new Date(parsed.createdAt) })
    .onConflictDoUpdate({
      target: [renderedChapters.bookId, renderedChapters.chapterId],
      set: { data: parsed, createdAt: new Date(parsed.createdAt) }
    });
}

export async function getRenderedChapter(bookId: string, chapterId: string): Promise<RenderedChapter | null> {
  const db = getDb();
  const [row] = await db
    .select({ data: renderedChapters.data })
    .from(renderedChapters)
    .where(and(eq(renderedChapters.bookId, bookId), eq(renderedChapters.chapterId, chapterId)))
    .limit(1);
  if (!row) return null;
  const parsed = RenderedChapterSchema.safeParse(row.data);
  // A stored render from an older schema is reported as absent rather than crashing the
  // reader; regenerating produces a current one.
  return parsed.success ? parsed.data : null;
}

export async function listRenderedChapterIds(bookId: string) {
  const db = getDb();
  const rows = await db
    .select({ chapterId: renderedChapters.chapterId })
    .from(renderedChapters)
    .where(eq(renderedChapters.bookId, bookId));
  return rows.map((row) => row.chapterId);
}

export async function deleteBook(userId: string, bookId: string) {
  await assertBookOwner(userId, bookId);
  const db = getDb();
  // Objects go first: a failure here leaves a readable book rather than dangling rows
  // pointing at bytes that no longer exist.
  await getStorage().removePrefix(bookPrefix(bookId));
  await db.delete(books).where(and(eq(books.id, bookId), eq(books.userId, userId)));
}

export async function saveArtifact(
  bookId: string,
  relativePath: string,
  data: Uint8Array | string,
  meta: Omit<ArtifactRef, 'key' | 'path' | 'createdAt'>
): Promise<ArtifactRef> {
  const key = artifactKey(bookId, relativePath);
  await getStorage().put(key, typeof data === 'string' ? new TextEncoder().encode(data) : data, meta.mimeType);
  return ArtifactRefSchema.parse({ key, path: artifactUrl(key), createdAt: new Date().toISOString(), ...meta });
}

/** Reads artifact bytes back for providers that need the original file as input. */
export async function readArtifact(ref: Pick<ArtifactRef, 'key'>) {
  return getStorage().get(ref.key);
}

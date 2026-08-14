import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  ArtifactRefSchema,
  BookManifestSchema,
  ChapterSchema,
  RenderedChapterSchema,
  type ArtifactRef,
  type BookManifest,
  type BookOrigin,
  type Chapter,
  type Character,
  type RenderedChapter,
  type VoiceProfile,
  type WorldElement
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
  origin: { kind: 'imported' } | { kind: 'generated'; status: Extract<BookOrigin, { kind: 'generated' }>['status']; requestedChapterCount: number };
  trashedAt: string | null;
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
      origin: parsed.origin,
      registryStatus: parsed.registryStatus,
      characters: parsed.characters,
      worldElements: parsed.worldElements,
      voices: parsed.voices,
      visualStyle: parsed.visualStyle,
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
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.trashedAt)))
    .limit(1);
  if (!book) throw new BookNotFoundError(bookId);
  const rows = await db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.order));
  return BookManifestSchema.parse({
    schemaVersion: book.schemaVersion,
    id: book.id,
    title: book.title,
    sourceName: book.sourceName,
    origin: book.origin,
    createdAt: book.createdAt.toISOString(),
    registryStatus: book.registryStatus,
    characters: book.characters,
    worldElements: book.worldElements,
    voices: book.voices,
    visualStyle: book.visualStyle,
    chapters: rows.map((row) => ({
      id: row.id,
      order: row.order,
      title: row.title,
      text: row.text,
      characterCount: row.characterCount
    }))
  });
}

async function summaries(userId: string, trashed: boolean): Promise<BookSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      sourceName: books.sourceName,
      createdAt: books.createdAt,
      trashedAt: books.trashedAt,
      registryStatus: books.registryStatus,
      origin: books.origin,
      characters: books.characters,
      chapterId: chapters.id
    })
    .from(books)
    .leftJoin(chapters, eq(chapters.bookId, books.id))
    .where(and(eq(books.userId, userId), trashed ? isNotNull(books.trashedAt) : isNull(books.trashedAt)))
    .orderBy(desc(books.createdAt));

  const found = new Map<string, BookSummary>();
  for (const row of rows) {
    const existing = found.get(row.id);
    if (existing) {
      if (row.chapterId) existing.chapterCount += 1;
      continue;
    }
    found.set(row.id, {
      id: row.id,
      title: row.title,
      sourceName: row.sourceName,
      createdAt: row.createdAt.toISOString(),
      trashedAt: row.trashedAt?.toISOString() ?? null,
      registryStatus: row.registryStatus,
      chapterCount: row.chapterId ? 1 : 0,
      characterCount: row.characters.length,
      origin: row.origin.kind === 'generated'
        ? { kind: 'generated', status: row.origin.status, requestedChapterCount: row.origin.requestedChapterCount }
        : { kind: 'imported' }
    });
  }
  return [...found.values()];
}

export const listBooks = (userId: string) => summaries(userId, false);
export const listTrashedBooks = (userId: string) => summaries(userId, true);

/** Updates only the provenance and display metadata of an AI-authored source. */
export async function saveGeneratedStoryState(
  userId: string,
  bookId: string,
  changes: { origin: Extract<BookOrigin, { kind: 'generated' }>; title?: string; sourceName?: string }
) {
  const db = getDb();
  const result = await db
    .update(books)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.trashedAt)));
  if (result.rowsAffected === 0) throw new BookNotFoundError(bookId);
}

/**
 * Appends one complete generated chapter. Existing source chapters are never rewritten:
 * a retried story job resumes from the first missing order instead.
 */
export async function saveGeneratedChapter(userId: string, bookId: string, value: Chapter) {
  const parsed = ChapterSchema.parse(value);
  await assertBookOwner(userId, bookId);
  const db = getDb();
  const existing = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.order, parsed.order)))
    .limit(1);
  if (existing.length) return false;
  await db.insert(chapters).values({ bookId, ...parsed });
  return true;
}

/** Confirms ownership without paying for the chapter text. */
export async function assertBookOwner(userId: string, bookId: string) {
  const db = getDb();
  const [book] = await db
    .select({ id: books.id, registryStatus: books.registryStatus })
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.trashedAt)))
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
  worldElements?: WorldElement[];
  voices?: VoiceProfile[];
  visualStyle?: BookManifest['visualStyle'];
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
  // Absent and incompatible are different failures: a stored render that no longer
  // matches the schema must not be silently reported as "not generated yet".
  if (!parsed.success) throw new Error(`Stored render ${chapterId} is incompatible or damaged`, { cause: parsed.error });
  return parsed.data;
}

export async function deleteRenderedChapter(bookId: string, chapterId: string) {
  const db = getDb();
  await db.delete(renderedChapters).where(and(eq(renderedChapters.bookId, bookId), eq(renderedChapters.chapterId, chapterId)));
}

/**
 * Recoverable deletion. The book leaves the library but its rows and artifacts stay,
 * because a chapter render costs real inference time and money.
 */
export async function trashBook(userId: string, bookId: string) {
  await assertBookOwner(userId, bookId);
  const db = getDb();
  await db.update(books).set({ trashedAt: new Date() }).where(and(eq(books.id, bookId), eq(books.userId, userId)));
}

export async function restoreBook(userId: string, bookId: string) {
  const db = getDb();
  await db.update(books).set({ trashedAt: null }).where(and(eq(books.id, bookId), eq(books.userId, userId)));
}

/** Permanent removal: rows and stored objects together. */
export async function purgeBook(userId: string, bookId: string) {
  const db = getDb();
  const [book] = await db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).limit(1);
  if (!book) throw new BookNotFoundError(bookId);
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

import { relations, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  BookManifest,
  Character,
  ChapterGenerationCheckpoint,
  GenerationJobStep,
  PlaybackProgress,
  RenderedChapter,
  VoiceProfile,
  WorldElement
} from '../../core/schemas';

// SQLite through libSQL, so the same schema serves a local file on one machine and a
// hosted Turso database when the web tier and the worker are on different machines.
// Timestamps are stored as epoch milliseconds; structured values as JSON text.

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());

// ---------------------------------------------------------------------------
// better-auth owns the four tables below. Column names follow better-auth's
// default model shape; renaming any of them breaks the drizzle adapter.
// ---------------------------------------------------------------------------

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index('session_user_id_idx').on(table.userId)]);

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index('account_user_id_idx').on(table.userId)]);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index('verification_identifier_idx').on(table.identifier)]);

// ---------------------------------------------------------------------------
// Storyloom domain. Every row that can contain book text or generated media is
// owned by exactly one user and is only ever queried through that owner.
// ---------------------------------------------------------------------------

/**
 * Bring-your-own-key material. Only the ciphertext lives here: the plaintext key is
 * recovered with STORYLOOM_ENCRYPTION_KEY at job execution time and is never sent to
 * the browser, logged, or embedded in an artifact.
 */
export const providerCredentials = sqliteTable('provider_credentials', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  hint: text('hint').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [primaryKey({ columns: [table.userId, table.provider] })]);

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull().default(1),
  title: text('title').notNull(),
  sourceName: text('source_name').notNull(),
  origin: text('origin', { mode: 'json' }).$type<BookManifest['origin']>().notNull().default({ kind: 'imported' }),
  registryStatus: text('registry_status', { enum: ['pending', 'processing', 'ready', 'failed'] }).notNull().default('pending'),
  characters: text('characters', { mode: 'json' }).$type<Character[]>().notNull().$defaultFn(() => []),
  worldElements: text('world_elements', { mode: 'json' }).$type<WorldElement[]>().notNull().$defaultFn(() => []),
  voices: text('voices', { mode: 'json' }).$type<VoiceProfile[]>().notNull().$defaultFn(() => []),
  visualStyle: text('visual_style', { mode: 'json' }).$type<BookManifest['visualStyle']>(),
  /** The wordless key image for the book, drawn by the registry pass. */
  coverImage: text('cover_image', { mode: 'json' }).$type<BookManifest['coverImage']>(),
  /** Set when the owner moves the book to the trash. Recoverable until purged. */
  trashedAt: integer('trashed_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index('books_user_id_created_at_idx').on(table.userId, table.createdAt)]);

/** Chapter text is stored in its own row so listing a library never loads a whole book. */
export const chapters = sqliteTable('chapters', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  order: integer('order').notNull(),
  title: text('title').notNull(),
  text: text('text').notNull(),
  characterCount: integer('character_count').notNull()
}, (table) => [
  primaryKey({ columns: [table.bookId, table.id] }),
  index('chapters_book_id_order_idx').on(table.bookId, table.order)
]);

export const renderedChapters = sqliteTable('rendered_chapters', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull(),
  data: text('data', { mode: 'json' }).$type<RenderedChapter>().notNull(),
  createdAt: createdAt()
}, (table) => [primaryKey({ columns: [table.bookId, table.chapterId] })]);

export const jobStatuses = ['queued', 'active', 'completed', 'failed', 'cancelled'] as const;
export const jobKinds = ['story', 'registry', 'chapter', 'chapter-audio', 'character-reference', 'book-cover'] as const;

/**
 * The durable record of a job. Live per-step progress lives in Redis instead, so a
 * running job does not keep writing to the database — which matters just as much for a
 * hosted SQLite as it does for a local file being read by two processes.
 */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id'),
  characterId: text('character_id'),
  /**
   * What this job regenerates, as one value. It exists so the uniqueness rule below can
   * be a plain column index: a SQL expression over two nullable columns is both harder
   * to read and not portable through the migration generator.
   */
  targetKey: text('target_key').notNull(),
  kind: text('kind', { enum: jobKinds }).notNull(),
  status: text('status', { enum: jobStatuses }).notNull().default('queued'),
  /** Forces regeneration even when a cached render exists. */
  force: integer('force', { mode: 'boolean' }).notNull().default(false),
  /** The deployment's runtime profile when the job was accepted, kept for provenance. */
  mode: text('mode', { enum: ['mock', 'local', 'cloud', 'hybrid'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  steps: text('steps', { mode: 'json' }).$type<GenerationJobStep[]>().notNull().$defaultFn(() => []),
  /** Durable only after a complete speech artifact is stored; live percentages stay in Redis. */
  checkpoint: text('checkpoint', { mode: 'json' }).$type<ChapterGenerationCheckpoint>(),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' })
}, (table) => [
  index('jobs_user_id_created_at_idx').on(table.userId, table.createdAt),
  index('jobs_book_id_created_at_idx').on(table.bookId, table.createdAt),
  // At most one unfinished job per target, enforced by the database rather than by a
  // read-then-write race in application code.
  uniqueIndex('jobs_active_target_idx')
    .on(table.bookId, table.kind, table.targetKey)
    .where(sql`${table.status} in ('queued', 'active')`)
]);

/** One durable listening cursor per account and chapter; updated at pause/page exit. */
export const playbackProgress = sqliteTable('playback_progress', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  utteranceId: text('utterance_id').notNull(),
  positionMs: integer('position_ms').notNull(),
  updatedAt: updatedAt()
}, (table) => [
  primaryKey({ columns: [table.userId, table.bookId, table.chapterId] }),
  index('playback_progress_book_idx').on(table.bookId)
]);

export const booksRelations = relations(books, ({ many, one }) => ({
  owner: one(user, { fields: [books.userId], references: [user.id] }),
  chapters: many(chapters),
  jobs: many(jobs)
}));

export const chaptersRelations = relations(chapters, ({ one }) => ({
  book: one(books, { fields: [chapters.bookId], references: [books.id] })
}));

export const schema = {
  user,
  session,
  account,
  verification,
  providerCredentials,
  books,
  chapters,
  renderedChapters,
  jobs,
  playbackProgress,
  booksRelations,
  chaptersRelations
};

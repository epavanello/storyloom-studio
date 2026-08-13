import { relations, sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Character, GenerationJobStep, RenderedChapter, VoiceProfile } from '../../core/schemas';

// ---------------------------------------------------------------------------
// better-auth owns the four tables below. Column names follow better-auth's
// default model shape; renaming any of them breaks the drizzle adapter.
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('session_user_id_idx').on(table.userId)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('account_user_id_idx').on(table.userId)]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('verification_identifier_idx').on(table.identifier)]);

// ---------------------------------------------------------------------------
// Storyloom domain. Every row that can contain book text or generated media is
// owned by exactly one user and is only ever queried through that owner.
// ---------------------------------------------------------------------------

/**
 * Where a user's heavy jobs run. `cloud` uses the shared multi-tenant queue with the
 * user's own OpenRouter key; `local` parks the job on a private queue that only that
 * user's own machine drains.
 */
export const executionTargets = ['cloud', 'local'] as const;

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  execution: text('execution', { enum: executionTargets }).notNull().default('cloud'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Bring-your-own-key material. Only the ciphertext lives here: the plaintext key is
 * recovered with STORYLOOM_ENCRYPTION_KEY at job execution time and is never sent to
 * the browser, logged, or embedded in an artifact.
 */
export const providerCredentials = pgTable('provider_credentials', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  hint: text('hint').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.userId, table.provider] })]);

export const books = pgTable('books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull().default(1),
  title: text('title').notNull(),
  sourceName: text('source_name').notNull(),
  registryStatus: text('registry_status', { enum: ['pending', 'processing', 'ready', 'failed'] }).notNull().default('pending'),
  characters: jsonb('characters').$type<Character[]>().notNull().default(sql`'[]'::jsonb`),
  voices: jsonb('voices').$type<VoiceProfile[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('books_user_id_created_at_idx').on(table.userId, table.createdAt)]);

/** Chapter text is stored in its own row so listing a library never loads a whole book. */
export const chapters = pgTable('chapters', {
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

export const renderedChapters = pgTable('rendered_chapters', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull(),
  data: jsonb('data').$type<RenderedChapter>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.bookId, table.chapterId] })]);

export const jobStatuses = ['queued', 'active', 'completed', 'failed', 'cancelled'] as const;

/**
 * The durable record of a job. Live per-step progress lives in Redis instead, so a
 * running job does not keep writing to Postgres — that keeps a serverless database
 * suspended for everything except state transitions.
 */
export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id'),
  kind: text('kind', { enum: ['registry', 'chapter'] }).notNull(),
  status: text('status', { enum: jobStatuses }).notNull().default('queued'),
  executionTarget: text('execution_target', { enum: executionTargets }).notNull(),
  queueName: text('queue_name').notNull(),
  mode: text('mode', { enum: ['mock', 'local', 'cloud', 'hybrid'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  steps: jsonb('steps').$type<GenerationJobStep[]>().notNull().default(sql`'[]'::jsonb`),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (table) => [
  index('jobs_user_id_created_at_idx').on(table.userId, table.createdAt),
  index('jobs_book_id_created_at_idx').on(table.bookId, table.createdAt),
  // At most one unfinished job per target, enforced by the database rather than by a
  // read-then-write race in application code.
  uniqueIndex('jobs_active_target_idx')
    .on(table.bookId, table.kind, sql`coalesce(${table.chapterId}, '')`)
    .where(sql`${table.status} in ('queued', 'active')`)
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
  userSettings,
  providerCredentials,
  books,
  chapters,
  renderedChapters,
  jobs,
  booksRelations,
  chaptersRelations
};

import { and, eq } from 'drizzle-orm';
import { ChapterGenerationCheckpointSchema, type ChapterGenerationCheckpoint } from '../core/schemas';
import { getDb } from './db/client';
import { jobs } from './db/schema';

export async function getChapterGenerationCheckpoint(
  userId: string,
  jobId: string,
  bookId: string,
  chapterId: string
) {
  const db = getDb();
  const [row] = await db
    .select({ checkpoint: jobs.checkpoint })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId), eq(jobs.bookId, bookId), eq(jobs.chapterId, chapterId)))
    .limit(1);
  if (!row?.checkpoint) return null;
  const parsed = ChapterGenerationCheckpointSchema.safeParse(row.checkpoint);
  if (!parsed.success) throw new Error(`Generation checkpoint ${jobId} is incompatible or damaged`, { cause: parsed.error });
  return parsed.data;
}

export async function saveChapterGenerationCheckpoint(checkpoint: ChapterGenerationCheckpoint) {
  const parsed = ChapterGenerationCheckpointSchema.parse(checkpoint);
  const db = getDb();
  const result = await db
    .update(jobs)
    .set({ checkpoint: parsed, updatedAt: new Date(parsed.updatedAt) })
    .where(and(eq(jobs.id, parsed.jobId), eq(jobs.userId, parsed.userId), eq(jobs.bookId, parsed.bookId), eq(jobs.chapterId, parsed.chapterId)));
  if (result.rowsAffected === 0) throw new Error(`Generation job ${parsed.jobId} is no longer available`);
  return parsed;
}

export async function clearChapterGenerationCheckpoint(userId: string, jobId: string) {
  const db = getDb();
  await db.update(jobs).set({ checkpoint: null }).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
}

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { GenerationJobSchema, type GenerationJob, type GenerationJobStep, type JobKind } from '../core/schemas';
import { getConfig } from './config';
import { getDb } from './db/client';
import { jobs } from './db/schema';
import type { ProgressUpdate } from './orchestrator';
import { forgetLiveJob, isCancellationRequested, publishJobState, readLiveJob, readLiveJobs, requestCancellation } from './queue/live';
import { getQueue, JOBS_QUEUE, queueSnapshot, waitingPosition, type JobPayload } from './queue/queues';
import { assertBookOwner } from './store';

export type JobRequest =
  | { kind: 'registry'; bookId: string }
  | { kind: 'chapter'; bookId: string; chapterId: string; force?: boolean }
  | { kind: 'chapter-audio'; bookId: string; chapterId: string }
  | { kind: 'character-reference'; bookId: string; characterId: string };

/** Raised when a cancel request is observed between steps. */
export class JobCancelledError extends Error {
  constructor() {
    super('Generation was cancelled');
    this.name = 'JobCancelledError';
  }
}

type JobRow = typeof jobs.$inferSelect;

function step(id: string, label: string): GenerationJobStep {
  return { id, label, status: 'pending', completed: 0, total: 1 };
}

export function stepsFor(kind: JobKind): GenerationJobStep[] {
  if (kind === 'character-reference') return [step('character-reference', 'Regenerate illustrated character reference')];
  if (kind === 'chapter-audio') return [step('speech', 'Regenerate narration and dialogue'), step('alignment', 'Realign words and audio')];
  return kind === 'registry'
    ? [step('registry-analysis', 'Read chapters and build continuity registries'), step('registry-references', 'Generate selected continuity references')]
    : [
        step('registry', 'Lock character, voice, and world identities'),
        step('plan', 'Direct the chapter'),
        step('speech', 'Generate narration and dialogue'),
        step('alignment', 'Synchronize words and audio'),
        step('visuals', 'Stage visual scenes')
      ];
}

function toJob(row: JobRow, queuePosition: number | null = null): GenerationJob {
  return GenerationJobSchema.parse({
    schemaVersion: 1,
    id: row.id,
    kind: row.kind,
    bookId: row.bookId,
    chapterId: row.chapterId,
    characterId: row.characterId,
    force: row.force,
    userId: row.userId,
    mode: row.mode,
    status: row.status,
    queuePosition,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.error,
    steps: row.steps
  });
}

function isUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message);
}

function targetOf(request: JobRequest) {
  const chapterId = request.kind === 'chapter' || request.kind === 'chapter-audio' ? request.chapterId : null;
  const characterId = request.kind === 'character-reference' ? request.characterId : null;
  return { chapterId, characterId, targetKey: `${chapterId ?? ''}|${characterId ?? ''}` };
}

async function findActiveJob(request: JobRequest) {
  const db = getDb();
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.bookId, request.bookId), eq(jobs.kind, request.kind), inArray(jobs.status, ['queued', 'active'])))
    .orderBy(desc(jobs.createdAt));
  const { targetKey } = targetOf(request);
  return rows.find((row) => row.targetKey === targetKey) ?? null;
}

/**
 * Accepts a generation request: it validates ownership, records the durable job row and
 * hands the work to the queue. Where that work actually executes is a property of the
 * deployment — a worker attached to this queue is either a cloud worker or a local one.
 */
export async function startGenerationJob(userId: string, request: JobRequest): Promise<GenerationJob> {
  await assertBookOwner(userId, request.bookId);
  const existing = await findActiveJob(request);
  if (existing) return decorate(toJob(existing));

  const row = {
    id: `job-${randomUUID()}`,
    userId,
    bookId: request.bookId,
    ...targetOf(request),
    kind: request.kind,
    status: 'queued' as const,
    force: request.kind === 'chapter' ? Boolean(request.force) : false,
    mode: getConfig().mode,
    steps: stepsFor(request.kind)
  };

  const db = getDb();
  try {
    await db.insert(jobs).values(row);
  } catch (error) {
    // The partial unique index is the real guard when two tabs race; losing that race
    // simply means joining the job that won.
    if (!isUniqueViolation(error)) throw error;
    const winner = await findActiveJob(request);
    if (winner) return decorate(toJob(winner));
    throw error;
  }

  const payload: JobPayload = {
    jobId: row.id,
    userId,
    bookId: row.bookId,
    chapterId: row.chapterId,
    characterId: row.characterId,
    kind: row.kind,
    force: row.force
  };
  await getQueue(JOBS_QUEUE).add(row.kind, payload, { jobId: row.id });

  const [stored] = await db.select().from(jobs).where(eq(jobs.id, row.id)).limit(1);
  const job = toJob(stored);
  await publishJobState(job);
  return decorate(job);
}

async function decorate(job: GenerationJob): Promise<GenerationJob> {
  if (job.status !== 'queued') return job;
  return { ...job, queuePosition: await waitingPosition(job.id).catch(() => null) };
}

/**
 * Recent jobs for a user. Live state comes from Redis so an open browser tab polling for
 * progress never touches the database; the database fills in anything older than the
 * Redis retention window.
 */
export async function jobsForUser(userId: string, options: { bookId?: string; limit?: number } = {}) {
  const limit = options.limit ?? 50;
  const live = await readLiveJobs(userId, limit).catch(() => [] as GenerationJob[]);
  const filtered = options.bookId ? live.filter((job) => job.bookId === options.bookId) : live;
  if (filtered.length >= limit) return Promise.all(filtered.slice(0, limit).map(decorate));

  const db = getDb();
  const conditions = options.bookId
    ? and(eq(jobs.userId, userId), eq(jobs.bookId, options.bookId))
    : eq(jobs.userId, userId);
  const rows = await db.select().from(jobs).where(conditions).orderBy(desc(jobs.createdAt)).limit(limit);
  const seen = new Set(filtered.map((job) => job.id));
  const merged = [...filtered, ...rows.filter((row) => !seen.has(row.id)).map((row) => toJob(row))];
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Promise.all(merged.slice(0, limit).map(decorate));
}

export async function getJob(userId: string, jobId: string) {
  const live = await readLiveJob(jobId).catch(() => null);
  if (live && live.userId === userId) return decorate(live);
  const db = getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  return row ? decorate(toJob(row)) : null;
}

/** Current depth of the deployment's queue and whether anything is draining it. */
export async function queueHealth() {
  return queueSnapshot();
}

export async function cancelJob(userId: string, jobId: string) {
  const db = getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!row) throw new Error('Job not found');
  if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'failed') return toJob(row);

  // Remove it from the queue if it has not started; if it has, the running worker
  // observes the cancellation flag at its next step boundary.
  const queued = await getQueue(JOBS_QUEUE).getJob(jobId);
  if (queued && !(await queued.isActive())) await queued.remove().catch(() => {});
  await requestCancellation(jobId);

  if (row.status === 'queued') {
    const job = await finalize(jobId, 'cancelled', { error: 'Cancelled before it started' });
    return job ?? toJob(row);
  }
  return toJob(row);
}

/**
 * Guards a destructive action on a book. Trashing one while a worker is mid-render
 * would leave that worker writing artifacts for a book that has left the library.
 */
export async function assertNoActiveJobs(userId: string, bookId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.bookId, bookId), inArray(jobs.status, ['queued', 'active'])))
    .limit(1);
  if (rows.length) throw new Error('This book still has a queued or running job. Cancel it first.');
}

export async function deleteJobRecord(userId: string, jobId: string) {
  const db = getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!row) return;
  if (row.status === 'queued' || row.status === 'active') throw new Error('Cancel the job before removing it');
  await db.delete(jobs).where(eq(jobs.id, jobId));
  await forgetLiveJob({ id: row.id, userId });
}

// ---------------------------------------------------------------------------
// Worker-side transitions. Each of these is a real state change, so it is worth a
// database write; per-step progress is not and goes only to Redis.
// ---------------------------------------------------------------------------

async function loadRow(jobId: string) {
  const db = getDb();
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!row) throw new Error(`Unknown job ${jobId}`);
  return row;
}

export async function markJobActive(jobId: string) {
  const db = getDb();
  const row = await loadRow(jobId);
  const startedAt = new Date();
  await db
    .update(jobs)
    .set({ status: 'active', startedAt, updatedAt: startedAt, attempts: row.attempts + 1, error: null })
    .where(eq(jobs.id, jobId));
  const job = toJob({ ...row, status: 'active', startedAt, updatedAt: startedAt, attempts: row.attempts + 1, error: null });
  await publishJobState(job);
  return job;
}

/**
 * Applies a step update to the live Redis copy only. The steps array is flushed to the
 * database once, when the job reaches a terminal state.
 */
export async function reportJobProgress(jobId: string, update: ProgressUpdate) {
  if (await isCancellationRequested(jobId)) throw new JobCancelledError();
  const job = await readLiveJob(jobId);
  if (!job) return;
  const steps = job.steps.map((candidate) => {
    if (candidate.id !== update.stepId) return candidate;
    return {
      ...candidate,
      status: update.status ?? candidate.status,
      completed: update.completed ?? candidate.completed,
      total: update.total ?? candidate.total,
      detail: update.detail ?? candidate.detail
    };
  });
  await publishJobState({ ...job, steps, updatedAt: new Date().toISOString() });
}

export async function finalize(
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled',
  options: { error?: string } = {}
) {
  const db = getDb();
  const live = await readLiveJob(jobId).catch(() => null);
  const row = await loadRow(jobId).catch(() => null);
  if (!row) return null;

  const steps = (live?.steps ?? row.steps).map((candidate) => {
    if (status === 'completed') return { ...candidate, status: 'completed' as const, completed: candidate.total };
    if (candidate.status === 'running') return { ...candidate, status: status === 'failed' ? ('failed' as const) : ('pending' as const) };
    return candidate;
  });
  const completedAt = new Date();
  await db
    .update(jobs)
    .set({ status, steps, error: options.error ?? null, completedAt, updatedAt: completedAt })
    .where(eq(jobs.id, jobId));
  const job = toJob({ ...row, status, steps, error: options.error ?? null, completedAt, updatedAt: completedAt });
  await publishJobState(job);
  return job;
}

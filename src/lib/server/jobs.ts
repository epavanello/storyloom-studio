import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { GenerationJobSchema, type GenerationJob, type GenerationJobStep, type JobKind } from '../core/schemas';
import { getConfig } from './config';
import { getDb } from './db/client';
import { jobs } from './db/schema';
import type { ProgressUpdate } from './orchestrator';
import { getQueueDriver, type JobPayload } from './queue/index';
import { assertBookOwner } from './store';

export type JobRequest =
  | { kind: 'story'; bookId: string }
  | { kind: 'registry'; bookId: string }
  | { kind: 'chapter'; bookId: string; chapterId: string; force?: boolean }
  | { kind: 'chapter-audio'; bookId: string; chapterId: string }
  | { kind: 'character-reference'; bookId: string; characterId: string }
  | { kind: 'book-cover'; bookId: string };

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

/**
 * Step labels are read by people who did not build the pipeline, so they name what is
 * happening to the book rather than the stage of the machine doing it.
 */
export function stepsFor(kind: JobKind): GenerationJobStep[] {
  if (kind === 'story') return [step('story-outline', 'Plan the story'), step('story-chapters', 'Write the chapters')];
  if (kind === 'character-reference') return [step('character-reference', 'Draw this character again')];
  if (kind === 'book-cover') return [step('registry-cover', 'Paint the cover')];
  if (kind === 'chapter-audio') return [step('speech', 'Record the voices'), step('alignment', 'Match the words to the audio')];
  return kind === 'registry'
    ? [step('registry-analysis', 'Read the book'), step('registry-references', 'Draw the cast and the places'), step('registry-cover', 'Paint the cover')]
    : [
        step('registry', 'Get the cast ready'),
        step('plan', 'Direct the chapter'),
        step('speech', 'Record the voices'),
        step('alignment', 'Match the words to the audio'),
        step('visuals', 'Illustrate the scenes')
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
  await getQueueDriver().enqueue(payload);

  const [stored] = await db.select().from(jobs).where(eq(jobs.id, row.id)).limit(1);
  const job = toJob(stored);
  await getQueueDriver().publishJobState(job);
  return decorate(job);
}

async function decorate(job: GenerationJob): Promise<GenerationJob> {
  if (job.status !== 'queued') return job;
  return { ...job, queuePosition: await getQueueDriver().waitingPosition(job.id).catch(() => null) };
}

/**
 * Recent jobs for a user. Live state comes from Redis so an open browser tab polling for
 * progress never touches the database; the database fills in anything older than the
 * Redis retention window.
 */
export async function jobsForUser(userId: string, options: { bookId?: string; limit?: number } = {}) {
  const limit = options.limit ?? 50;
  const live = await getQueueDriver().readLiveJobs(userId, limit).catch(() => [] as GenerationJob[]);
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
  const live = await getQueueDriver().readLiveJob(jobId).catch(() => null);
  if (live && live.userId === userId) return decorate(live);
  const db = getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  return row ? decorate(toJob(row)) : null;
}

/** Current depth of the deployment's queue and whether anything is draining it. */
export async function queueHealth() {
  return getQueueDriver().snapshot();
}

export async function cancelJob(userId: string, jobId: string) {
  const db = getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!row) throw new Error('Job not found');
  if (row.status === 'completed' || row.status === 'cancelled' || row.status === 'failed') return toJob(row);

  // Remove it from the queue if it has not started; if it has, the running worker
  // observes the cancellation flag at its next step boundary.
  await getQueueDriver().removeIfWaiting(jobId);
  await getQueueDriver().requestCancellation(jobId);

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
  await getQueueDriver().forgetLiveJob({ id: row.id, userId });
}

/**
 * Puts a failed job back on the queue under its own id.
 *
 * The id is the point: a chapter job stores its validated plan and every synthesized
 * passage in a checkpoint keyed by that id, so resuming the same job reuses work that was
 * already paid for, while starting a fresh job would silently buy all of it again. It is
 * therefore the correct answer to a provider that refused mid-run — an exhausted key, a
 * rate limit — once the cause is fixed.
 */
export async function resumeGenerationJob(userId: string, jobId: string): Promise<GenerationJob> {
  const db = getDb();
  const [row] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!row) throw new Error('Job not found');
  if (row.status === 'queued' || row.status === 'active') return decorate(toJob(row));
  if (row.status === 'completed') throw new Error('This job already completed');
  if (row.status === 'cancelled') throw new Error('A cancelled job cannot be resumed. Start the generation again.');
  await assertBookOwner(userId, row.bookId);

  // Another job may already be working on the same target, in which case resuming would
  // both duplicate the work and violate the partial unique index that guards it.
  const [conflict] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.bookId, row.bookId), eq(jobs.kind, row.kind), inArray(jobs.status, ['queued', 'active'])))
    .orderBy(desc(jobs.createdAt));
  if (conflict?.targetKey === row.targetKey) return decorate(toJob(conflict));

  const updatedAt = new Date();
  // A step that failed goes back to pending; completed steps stay completed, so the
  // progress view resumes where it stopped instead of restarting at zero.
  const steps = row.steps.map((step) => (step.status === 'failed' ? { ...step, status: 'pending' as const } : step));
  await db
    .update(jobs)
    .set({ status: 'queued', steps, error: null, startedAt: null, completedAt: null, updatedAt })
    .where(eq(jobs.id, jobId));
  const job = toJob({ ...row, status: 'queued', steps, error: null, startedAt: null, completedAt: null, updatedAt });
  await getQueueDriver().publishJobState(job);
  await getQueueDriver().enqueue({
    jobId: row.id,
    userId: row.userId,
    bookId: row.bookId,
    chapterId: row.chapterId,
    characterId: row.characterId,
    kind: row.kind,
    force: row.force
  });
  return decorate(job);
}

/**
 * Re-enqueues work that was accepted but never finished, so a restart does not strand
 * it. The in-process queue holds nothing across a restart, which makes the `jobs` table
 * the durable record of what was owed. Queued and active work goes back on the queue;
 * completed speech checkpoints let the orchestrator skip compatible passages.
 */
export async function recoverInterruptedJobs() {
  const queue = getQueueDriver();
  if (queue.kind !== 'memory') return { requeued: 0, interrupted: 0 };

  const db = getDb();
  const rows = await db.select().from(jobs).where(inArray(jobs.status, ['queued', 'active']));
  let requeued = 0;
  let interrupted = 0;

  for (const row of rows) {
    if (row.status === 'active') {
      const updatedAt = new Date();
      await db
        .update(jobs)
        .set({ status: 'queued', startedAt: null, completedAt: null, error: null, updatedAt })
        .where(eq(jobs.id, row.id));
      const recovered = toJob({ ...row, status: 'queued', startedAt: null, completedAt: null, error: null, updatedAt });
      await queue.publishJobState(recovered);
      await queue.enqueue({
        jobId: row.id,
        userId: row.userId,
        bookId: row.bookId,
        chapterId: row.chapterId,
        characterId: row.characterId,
        kind: row.kind,
        force: row.force
      });
      interrupted += 1;
      continue;
    }
    const job = toJob(row);
    await queue.publishJobState(job);
    await queue.enqueue({
      jobId: row.id,
      userId: row.userId,
      bookId: row.bookId,
      chapterId: row.chapterId,
      characterId: row.characterId,
      kind: row.kind,
      force: row.force
    });
    requeued += 1;
  }

  if (requeued || interrupted) console.log(`[queue] recovered ${requeued} queued job(s), resumed ${interrupted} interrupted job(s)`);
  return { requeued, interrupted };
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
  await getQueueDriver().publishJobState(job);
  return job;
}

/**
 * Applies a step update to the live Redis copy only. The steps array is flushed to the
 * database once, when the job reaches a terminal state.
 */
export async function reportJobProgress(jobId: string, update: ProgressUpdate) {
  const queue = getQueueDriver();
  if (await queue.isCancellationRequested(jobId)) throw new JobCancelledError();
  const job = await queue.readLiveJob(jobId);
  if (!job) return;
  const steps = job.steps.map((candidate) => {
    if (candidate.id !== update.stepId) return candidate;
    return {
      ...candidate,
      status: update.status ?? candidate.status,
      completed: update.completed ?? candidate.completed,
      total: update.total ?? candidate.total,
      detail: update.detail ?? candidate.detail,
      // Time-based progress lives only as long as the call reporting it: any other update
      // is a real change of state, and keeping a stale fraction would let the bar jump
      // backwards the moment the next call starts its own clock.
      progress: update.progress === undefined ? undefined : Math.min(1, Math.max(0, update.progress))
    };
  });
  const audioPreview = update.audioPreview
    ? [
        ...job.audioPreview.filter((item) => item.utterance.id !== update.audioPreview!.utterance.id),
        update.audioPreview
      ].sort((a, b) => a.utterance.order - b.utterance.order)
    : job.audioPreview;
  const alignedPreview = update.alignedPreview
    ? [...job.alignedPreview.filter((item) => item.utterance.id !== update.alignedPreview!.utterance.id), update.alignedPreview]
      .sort((a, b) => a.utterance.order - b.utterance.order)
    : job.alignedPreview;
  const visualPreview = update.visualPreview
    ? [...job.visualPreview.filter((item) => item.cue.id !== update.visualPreview!.cue.id), update.visualPreview]
    : job.visualPreview;
  await queue.publishJobState({
    ...job,
    steps,
    audioPreview,
    alignedPreview,
    visualPreview,
    chapterPlan: update.chapterPlan ?? job.chapterPlan,
    updatedAt: new Date().toISOString()
  });
}

export async function finalize(
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled',
  options: { error?: string } = {}
) {
  const db = getDb();
  const live = await getQueueDriver().readLiveJob(jobId).catch(() => null);
  const row = await loadRow(jobId).catch(() => null);
  if (!row) return null;

  const steps = (live?.steps ?? row.steps).map((candidate) => {
    // No call is in flight once the job is over, so no step keeps a moving bar.
    if (status === 'completed') return { ...candidate, status: 'completed' as const, completed: candidate.total, progress: undefined };
    if (candidate.status === 'running') return { ...candidate, status: status === 'failed' ? ('failed' as const) : ('pending' as const), progress: undefined };
    return candidate;
  });
  const completedAt = new Date();
  await db
    .update(jobs)
    .set({ status, steps, error: options.error ?? null, completedAt, updatedAt: completedAt })
    .where(eq(jobs.id, jobId));
  const job = toJob({ ...row, status, steps, error: options.error ?? null, completedAt, updatedAt: completedAt });
  await getQueueDriver().publishJobState(job);
  return job;
}

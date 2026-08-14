import type { GenerationJob, JobKind, QueueSnapshot } from '../../core/schemas';

/** Everything a worker needs to run a job; the durable detail stays in the database. */
export type JobPayload = {
  jobId: string;
  userId: string;
  bookId: string;
  chapterId: string | null;
  characterId: string | null;
  kind: JobKind;
  force: boolean;
};

export type JobHandler = (payload: JobPayload) => Promise<void>;

export type RunningWorker = { stop: () => Promise<void> };

/**
 * The queue as the rest of the application sees it: accepting work, reporting depth,
 * and holding the live per-job state that the browser polls.
 *
 * Two implementations exist because the two deployment shapes have genuinely different
 * needs. A distributed deployment must hand work to another machine, which requires a
 * real broker. A single-process deployment does not, and should not have to install one.
 */
export type QueueDriver = {
  readonly kind: 'redis' | 'memory';
  /** Human-readable name of the queue, shown in the job dashboard. */
  readonly name: string;

  enqueue(payload: JobPayload): Promise<void>;
  /** Drops a job that has not started. False means it is already running. */
  removeIfWaiting(jobId: string): Promise<boolean>;
  snapshot(): Promise<QueueSnapshot>;
  /** 1-based position among the jobs still waiting, or null if not waiting. */
  waitingPosition(jobId: string): Promise<number | null>;
  startWorker(handler: JobHandler, concurrency: number): RunningWorker;

  // Live state. Frequent progress updates land here and never in the database.
  publishJobState(job: GenerationJob): Promise<void>;
  readLiveJob(jobId: string): Promise<GenerationJob | null>;
  readLiveJobs(userId: string, limit: number): Promise<GenerationJob[]>;
  forgetLiveJob(job: Pick<GenerationJob, 'id' | 'userId'>): Promise<void>;

  /**
   * Cooperative cancellation: neither driver can interrupt a running handler, so a
   * cancel request sets a flag the orchestrator observes between steps.
   */
  requestCancellation(jobId: string): Promise<void>;
  isCancellationRequested(jobId: string): Promise<boolean>;

  close(): Promise<void>;
};

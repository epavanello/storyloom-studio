import { Queue } from 'bullmq';
import type { JobKind, QueueSnapshot } from '../../core/schemas';
import { getConfig } from '../config';
import { getRedis } from './connection';

/**
 * One queue for the whole deployment. A deployment is either cloud or local — it is
 * never both — so where a job runs is a property of the deployment, not of the job.
 */
export const JOBS_QUEUE = 'storyloom-jobs';

/** Everything a worker needs to run a job; the durable detail stays in Postgres. */
export type JobPayload = {
  jobId: string;
  userId: string;
  bookId: string;
  chapterId: string | null;
  characterId: string | null;
  kind: JobKind;
  force: boolean;
};

const stateKey = Symbol.for('storyloom.queues');
const globalState = globalThis as typeof globalThis & { [stateKey]?: Map<string, Queue<JobPayload>> };
const queues = globalState[stateKey] ??= new Map<string, Queue<JobPayload>>();

/** Namespaces BullMQ's own Redis keys, so one Redis can serve several deployments. */
export function queuePrefix() {
  return getConfig().queuePrefix;
}

export function getQueue(name: string) {
  const cacheKey = `${queuePrefix()}/${name}`;
  const existing = queues.get(cacheKey);
  if (existing) return existing;
  const queue = new Queue<JobPayload>(name, {
    connection: getRedis(),
    prefix: queuePrefix(),
    defaultJobOptions: {
      // Heavy generation is expensive and partially resumable from cached artifacts, so
      // a failed job is surfaced to the user instead of being retried blindly.
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60, count: 200 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 }
    }
  });
  queues.set(cacheKey, queue);
  return queue;
}

export async function queueSnapshot(name = JOBS_QUEUE): Promise<QueueSnapshot> {
  const queue = getQueue(name);
  const [counts, workers] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    // Surfacing this matters: with no worker attached, a job waits indefinitely and the
    // user deserves to be told why rather than watching a spinner.
    queue.getWorkers().catch(() => [])
  ]);
  return {
    name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    hasWorker: workers.length > 0
  };
}

/** 1-based position among the jobs still waiting. */
export async function waitingPosition(jobId: string, name = JOBS_QUEUE) {
  const waiting = await getQueue(name).getWaiting(0, 500);
  const index = waiting.findIndex((job) => job.id === jobId);
  return index >= 0 ? index + 1 : null;
}

export async function closeQueues() {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(open.map((queue) => queue.close()));
}

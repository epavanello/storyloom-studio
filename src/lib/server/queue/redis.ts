import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { GenerationJobSchema, type GenerationJob, type QueueSnapshot } from '../../core/schemas';
import type { JobHandler, JobPayload, QueueDriver, RunningWorker } from './driver';

const RETENTION_SECONDS = 24 * 60 * 60;

export type RedisQueueOptions = {
  url: string;
  name: string;
  prefix: string;
  lockDurationMs: number;
  stalledIntervalMs: number;
};

/**
 * Broker-backed queue. Required whenever the producer and the worker are different
 * processes, which is every deployment where inference runs on another machine.
 */
export function createRedisQueue(options: RedisQueueOptions): QueueDriver {
  const connection = new IORedis(options.url, {
    // BullMQ's blocking commands must never be aborted mid-wait.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000)
  });
  connection.on('error', (error) => console.error('[redis]', error.message));

  const queue = new Queue<JobPayload>(options.name, {
    connection,
    prefix: options.prefix,
    defaultJobOptions: {
      // Heavy generation is expensive and only partially resumable, so a failure is
      // surfaced to the user instead of being retried blindly.
      attempts: 1,
      removeOnComplete: { age: RETENTION_SECONDS, count: 200 },
      removeOnFail: { age: 7 * RETENTION_SECONDS, count: 200 }
    }
  });

  const jobKey = (jobId: string) => `${options.prefix}:job:${jobId}`;
  const indexKey = (userId: string) => `${options.prefix}:user:${userId}:jobs`;
  const cancelKey = (jobId: string) => `${options.prefix}:job:${jobId}:cancel`;
  const workers: Worker<JobPayload>[] = [];

  return {
    kind: 'redis',
    name: options.name,

    async enqueue(payload) {
      await queue.add(payload.kind, payload, { jobId: payload.jobId });
    },

    async removeIfWaiting(jobId) {
      const job = await queue.getJob(jobId);
      if (!job || (await job.isActive())) return false;
      await job.remove().catch(() => {});
      return true;
    },

    async snapshot(): Promise<QueueSnapshot> {
      const [counts, seen] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
        // Surfacing this matters: with no worker attached, a job waits indefinitely and
        // the user deserves to be told why.
        queue.getWorkers().catch(() => [])
      ]);
      return {
        name: options.name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        hasWorker: seen.length > 0
      };
    },

    async waitingPosition(jobId) {
      const pending = await queue.getWaiting(0, 500);
      const index = pending.findIndex((job) => job.id === jobId);
      return index < 0 ? null : index + 1;
    },

    startWorker(handler: JobHandler, concurrency: number): RunningWorker {
      const worker = new Worker<JobPayload>(options.name, (job) => handler(job.data), {
        connection,
        prefix: options.prefix,
        concurrency,
        // A chapter render holds the lock for minutes while a model runs, so the lock
        // has to outlive a single heavy step rather than the default 30 seconds.
        lockDuration: options.lockDurationMs,
        stalledInterval: options.stalledIntervalMs,
        maxStalledCount: 1
      });
      worker.on('failed', (job, error) => console.error(`[worker] job ${job?.id ?? 'unknown'} failed:`, error.message));
      worker.on('error', (error) => console.error('[worker]', error.message));
      worker.on('ready', () => console.log(`[worker] listening on ${options.name} via Redis (concurrency ${concurrency})`));
      workers.push(worker);
      return { stop: () => worker.close() };
    },

    async publishJobState(job) {
      const now = Date.now();
      await connection
        .multi()
        .set(jobKey(job.id), JSON.stringify(job), 'EX', RETENTION_SECONDS)
        .zadd(indexKey(job.userId), now, job.id)
        .zremrangebyscore(indexKey(job.userId), 0, now - RETENTION_SECONDS * 1000)
        .expire(indexKey(job.userId), RETENTION_SECONDS * 2)
        .exec();
    },

    async readLiveJob(jobId) {
      const raw = await connection.get(jobKey(jobId));
      if (!raw) return null;
      const parsed = GenerationJobSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    },

    async readLiveJobs(userId, limit) {
      const ids = await connection.zrevrange(indexKey(userId), 0, limit - 1);
      if (!ids.length) return [];
      const raws = await connection.mget(ids.map(jobKey));
      const jobs: GenerationJob[] = [];
      const expired: string[] = [];
      for (const [index, raw] of raws.entries()) {
        if (!raw) {
          expired.push(ids[index]);
          continue;
        }
        const parsed = GenerationJobSchema.safeParse(JSON.parse(raw));
        if (parsed.success) jobs.push(parsed.data);
      }
      if (expired.length) await connection.zrem(indexKey(userId), ...expired);
      return jobs;
    },

    async forgetLiveJob(job) {
      await connection.multi().del(jobKey(job.id)).del(cancelKey(job.id)).zrem(indexKey(job.userId), job.id).exec();
    },

    async requestCancellation(jobId) {
      await connection.set(cancelKey(jobId), '1', 'EX', RETENTION_SECONDS);
    },

    async isCancellationRequested(jobId) {
      return (await connection.exists(cancelKey(jobId))) === 1;
    },

    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await queue.close();
      await connection.quit().catch(() => connection.disconnect());
    }
  };
}

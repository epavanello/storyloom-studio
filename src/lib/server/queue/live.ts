import { GenerationJobSchema, type GenerationJob } from '../../core/schemas';
import { getConfig } from '../config';
import { getRedis } from './connection';

/**
 * Live job state lives in Redis rather than Postgres.
 *
 * A running chapter emits a progress update per utterance, per scene and per chapter
 * read. Writing those to a serverless Postgres would keep its compute awake for the
 * whole render and again for every browser poll. Redis absorbs that traffic; Postgres
 * only sees the durable state transitions in `jobs.ts`.
 */

const RETENTION_SECONDS = 24 * 60 * 60;

// Namespaced with the same prefix as the queues, so one Redis can serve several
// deployments without their live job state overlapping.
const jobKey = (jobId: string) => `${getConfig().queuePrefix}:job:${jobId}`;
const indexKey = (userId: string) => `${getConfig().queuePrefix}:user:${userId}:jobs`;
const cancelKey = (jobId: string) => `${getConfig().queuePrefix}:job:${jobId}:cancel`;

export async function publishJobState(job: GenerationJob) {
  const redis = getRedis();
  const now = Date.now();
  await redis
    .multi()
    .set(jobKey(job.id), JSON.stringify(job), 'EX', RETENTION_SECONDS)
    .zadd(indexKey(job.userId), now, job.id)
    .zremrangebyscore(indexKey(job.userId), 0, now - RETENTION_SECONDS * 1000)
    .expire(indexKey(job.userId), RETENTION_SECONDS * 2)
    .exec();
}

export async function readLiveJob(jobId: string): Promise<GenerationJob | null> {
  const raw = await getRedis().get(jobKey(jobId));
  if (!raw) return null;
  const parsed = GenerationJobSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** Recent jobs for a user, newest first, without touching the database. */
export async function readLiveJobs(userId: string, limit = 50): Promise<GenerationJob[]> {
  const redis = getRedis();
  const ids = await redis.zrevrange(indexKey(userId), 0, limit - 1);
  if (!ids.length) return [];
  const raws = await redis.mget(ids.map(jobKey));
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
  if (expired.length) await redis.zrem(indexKey(userId), ...expired);
  return jobs;
}

export async function forgetLiveJob(job: Pick<GenerationJob, 'id' | 'userId'>) {
  const redis = getRedis();
  await redis.multi().del(jobKey(job.id)).del(cancelKey(job.id)).zrem(indexKey(job.userId), job.id).exec();
}

/**
 * Cooperative cancellation. BullMQ cannot interrupt a running handler, so a cancel
 * request sets a flag that the orchestrator's progress reporter observes between steps.
 */
export async function requestCancellation(jobId: string) {
  await getRedis().set(cancelKey(jobId), '1', 'EX', RETENTION_SECONDS);
}

export async function isCancellationRequested(jobId: string) {
  return (await getRedis().exists(cancelKey(jobId))) === 1;
}

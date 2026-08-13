import { Worker, type Job } from 'bullmq';
import { getConfig } from '../config';
import { buildRunContext } from '../context';
import { finalize, JobCancelledError, markJobActive, reportJobProgress } from '../jobs';
import { prepareChapter, prepareRegistry } from '../orchestrator';
import { getRedis } from './connection';
import { isCancellationRequested } from './live';
import { JOBS_QUEUE, queuePrefix, type JobPayload } from './queues';

/**
 * Runs one queued generation job to completion.
 *
 * The handler is deliberately the only place that knows how a queue entry maps onto the
 * orchestrator: everything else — routes, the dashboard, the standalone worker — talks
 * about jobs, not about BullMQ.
 */
async function execute(job: Job<JobPayload>) {
  const { jobId, userId, bookId, chapterId, kind } = job.data;
  if (await isCancellationRequested(jobId)) {
    await finalize(jobId, 'cancelled', { error: 'Cancelled before it started' });
    return;
  }

  await markJobActive(jobId);
  const context = await buildRunContext(userId, bookId, jobId);
  const report = (update: Parameters<typeof reportJobProgress>[1]) => reportJobProgress(jobId, update);

  try {
    if (kind === 'registry') await prepareRegistry(context, report);
    else await prepareChapter(context, chapterId!, report);
    await finalize(jobId, 'completed');
  } catch (error) {
    if (error instanceof JobCancelledError) {
      await finalize(jobId, 'cancelled', { error: 'Cancelled while running' });
      return;
    }
    const message = error instanceof Error ? error.message : 'Generation failed';
    await finalize(jobId, 'failed', { error: message });
    // Rethrown so BullMQ records the failure too and the queue snapshot stays truthful.
    throw error;
  }
}

export type RunningWorker = { worker: Worker<JobPayload>; stop: () => Promise<void> };

/** Attaches a consumer to the deployment's queue. */
export function startWorker(): RunningWorker {
  const config = getConfig();
  const worker = new Worker<JobPayload>(JOBS_QUEUE, execute, {
    connection: getRedis(),
    prefix: queuePrefix(),
    concurrency: config.worker.concurrency,
    // A chapter render holds the lock for minutes at a time while a model runs, so the
    // lock has to outlive a single heavy step rather than the default 30 seconds.
    lockDuration: config.worker.lockDurationMs,
    stalledInterval: config.worker.stalledIntervalMs,
    maxStalledCount: 1
  });
  worker.on('failed', (job, error) => console.error(`[worker] job ${job?.id ?? 'unknown'} failed:`, error.message));
  worker.on('error', (error) => console.error('[worker]', error.message));
  worker.on('ready', () => console.log(`[worker] listening on ${JOBS_QUEUE} (mode ${config.mode}, concurrency ${config.worker.concurrency})`));

  return { worker, stop: () => worker.close() };
}

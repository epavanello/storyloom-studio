import { GenerationJobSchema, type GenerationJob, type QueueSnapshot } from '../../core/schemas';
import type { JobHandler, JobPayload, QueueDriver, RunningWorker } from './driver';

/**
 * In-process queue for a single-process deployment.
 *
 * It exists so self-hosting does not require running a broker. It is only ever selected
 * when this process is also the worker, because nothing outside the process can see
 * these structures.
 *
 * What it deliberately does not do is pretend to be durable. Everything here is lost
 * when the process exits; durability comes from the `jobs` table, and
 * `recoverInterruptedJobs` in jobs.ts re-enqueues what was still waiting at boot.
 */
export function createMemoryQueue(name: string): QueueDriver {
  const waiting: JobPayload[] = [];
  const active = new Set<string>();
  const live = new Map<string, GenerationJob>();
  const cancelled = new Set<string>();
  let completed = 0;
  let failed = 0;
  let workers = 0;

  /**
   * Lanes park here instead of spinning. Every waiter is kept, not just the latest:
   * with concurrency above one there are several parked lanes, and waking only the
   * most recent would strand the others — including on shutdown, which would hang.
   */
  let waiters: (() => void)[] = [];
  const idle = () => new Promise<void>((resolve) => { waiters.push(resolve); });
  const nudge = () => {
    const parked = waiters;
    waiters = [];
    for (const resume of parked) resume();
  };

  return {
    kind: 'memory',
    name,

    async enqueue(payload) {
      waiting.push(payload);
      nudge();
    },

    async removeIfWaiting(jobId) {
      const index = waiting.findIndex((item) => item.jobId === jobId);
      if (index < 0) return false;
      waiting.splice(index, 1);
      return true;
    },

    async snapshot(): Promise<QueueSnapshot> {
      return {
        name,
        waiting: waiting.length,
        active: active.size,
        // Nothing here is ever scheduled for later; the field exists for the Redis driver.
        delayed: 0,
        completed,
        failed,
        hasWorker: workers > 0
      };
    },

    async waitingPosition(jobId) {
      const index = waiting.findIndex((item) => item.jobId === jobId);
      return index < 0 ? null : index + 1;
    },

    startWorker(handler: JobHandler, concurrency: number): RunningWorker {
      workers += 1;
      let stopping = false;

      const lane = async () => {
        while (!stopping) {
          const payload = waiting.shift();
          if (!payload) {
            await idle();
            continue;
          }
          active.add(payload.jobId);
          try {
            await handler(payload);
            completed += 1;
          } catch (error) {
            failed += 1;
            console.error(`[worker] job ${payload.jobId} failed:`, error instanceof Error ? error.message : error);
          } finally {
            active.delete(payload.jobId);
          }
        }
      };

      const lanes = Array.from({ length: Math.max(1, concurrency) }, () => lane());
      console.log(`[worker] listening on ${name} in-process (concurrency ${concurrency})`);

      return {
        stop: async () => {
          stopping = true;
          workers = Math.max(0, workers - 1);
          nudge();
          await Promise.all(lanes);
        }
      };
    },

    async publishJobState(job) {
      // Parsed on the way in so the in-memory copy cannot drift from the Redis driver's,
      // which round-trips through JSON.
      live.set(job.id, GenerationJobSchema.parse(structuredClone(job)));
    },

    async readLiveJob(jobId) {
      return live.get(jobId) ?? null;
    },

    async readLiveJobs(userId, limit) {
      return [...live.values()]
        .filter((job) => job.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
    },

    async forgetLiveJob(job) {
      live.delete(job.id);
      cancelled.delete(job.id);
    },

    async requestCancellation(jobId) {
      cancelled.add(jobId);
    },

    async isCancellationRequested(jobId) {
      return cancelled.has(jobId);
    },

    async close() {
      waiting.length = 0;
      live.clear();
      cancelled.clear();
    }
  };
}

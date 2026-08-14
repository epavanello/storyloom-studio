import { getConfig } from '../config';
import type { QueueDriver } from './driver';
import { createDisabledQueue } from './disabled';
import { createMemoryQueue } from './memory';
import { createRedisQueue } from './redis';

export const JOBS_QUEUE = 'storyloom-jobs';

const stateKey = Symbol.for('storyloom.queue-driver');
const globalState = globalThis as typeof globalThis & { [stateKey]?: { signature: string; driver: QueueDriver } };

/**
 * Picks the queue implementation from the deployment shape rather than from a
 * preference: a process that is not also the worker cannot use an in-process queue,
 * because nothing outside the process can see it.
 */
export function getQueueDriver(): QueueDriver {
  const config = getConfig();
  const signature = JSON.stringify([config.redisUrl, config.queuePrefix, config.worker]);
  const existing = globalState[stateKey];
  if (existing && existing.signature === signature) return existing.driver;

  // Three shapes, decided by configuration rather than preference:
  //   Redis          — producer and worker are different processes
  //   in-process     — one process does both
  //   disabled       — this deployment only reads; something else generates
  const driver = config.redisUrl
    ? createRedisQueue({
        url: config.redisUrl,
        name: JOBS_QUEUE,
        prefix: config.queuePrefix,
        lockDurationMs: config.worker.lockDurationMs,
        stalledIntervalMs: config.worker.stalledIntervalMs
      })
    : config.worker.mode === 'off'
      ? createDisabledQueue(JOBS_QUEUE)
      : createMemoryQueue(JOBS_QUEUE);

  if (driver.kind === 'memory' && config.worker.mode !== 'inline') {
    throw new Error(
      `STORYLOOM_WORKER_MODE=${config.worker.mode} needs REDIS_URL. An in-process queue is invisible to any other process, so a separate worker would never see the work. Set REDIS_URL, or use STORYLOOM_WORKER_MODE=inline.`
    );
  }

  globalState[stateKey] = { signature, driver };
  return driver;
}

export async function closeQueue() {
  const existing = globalState[stateKey];
  if (!existing) return;
  delete globalState[stateKey];
  await existing.driver.close();
}

export type { JobPayload, QueueDriver, RunningWorker } from './driver';

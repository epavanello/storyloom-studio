/**
 * Standalone Storyloom worker.
 *
 * The web application and the machine that runs inference do not have to be the same
 * box. This entrypoint attaches to the same Postgres, Redis and object storage as the
 * web deployment and drains its queue:
 *
 *   pnpm worker:local
 *
 * A deployment is either cloud or local; this worker inherits that from its own
 * configuration. The profile-specific scripts load `.env` first and then the matching
 * `.env.storyloom-*` overlay, with explicitly exported variables retaining priority.
 */
import { closeDb } from './lib/server/db/client';
import { getConfig } from './lib/server/config';
import { closeQueue, getQueueDriver, JOBS_QUEUE } from './lib/server/queue/index';
import { startWorker } from './lib/server/queue/worker';

const config = getConfig();
const queue = getQueueDriver();

// This entrypoint is a separate process by definition, so an in-process queue can never
// reach it: it would build a second, private queue, drain nothing the web tier accepted,
// and its recovery pass would declare that tier's running jobs interrupted. Refuse
// instead of starting something that looks healthy and does nothing.
if (queue.kind === 'memory') {
  console.error(
    '[worker] REDIS_URL is not set, so the queue lives inside whichever process created it.\n' +
    '         A standalone worker cannot share that queue.\n' +
    '         Either run the web app alone with STORYLOOM_WORKER_MODE=inline, which already\n' +
    '         runs a worker in-process, or set REDIS_URL on both sides to split them apart.'
  );
  process.exit(1);
}

console.log(`[worker] mode=${config.mode} storage=${config.storage.driver} queue=${queue.kind}:${JOBS_QUEUE}`);

const running = startWorker();
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received, finishing the current job before exiting`);
  try {
    await running.stop();
    await closeQueue();
    await closeDb();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

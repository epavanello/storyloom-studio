/**
 * Standalone Storyloom worker.
 *
 * The web application and the machine that runs inference do not have to be the same
 * box. This entrypoint attaches to the same Postgres, Redis and object storage as the
 * web deployment and drains its queue:
 *
 *   STORYLOOM_MODE=local pnpm worker
 *
 * A deployment is either cloud or local; this worker inherits that from its own
 * configuration. Run it with an exported environment or `--env-file`, since it does not
 * go through SvelteKit and therefore does not read `.env.storyloom-*` on its own.
 */
import { closeDb } from './lib/server/db/client';
import { getConfig } from './lib/server/config';
import { closeRedis } from './lib/server/queue/connection';
import { closeQueues, JOBS_QUEUE } from './lib/server/queue/queues';
import { startWorker } from './lib/server/queue/worker';

const config = getConfig();
console.log(`[worker] mode=${config.mode} storage=${config.storage.driver} queue=${config.queuePrefix}:${JOBS_QUEUE}`);

const running = startWorker();
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received, finishing the current job before exiting`);
  try {
    await running.stop();
    await closeQueues();
    await closeRedis();
    await closeDb();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

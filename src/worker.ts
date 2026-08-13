/**
 * Standalone Storyloom worker.
 *
 * The web application and the machine that runs inference do not have to be the same
 * box. This entrypoint attaches to the same Redis, Postgres and object storage as the
 * web deployment and drains the queues named in `STORYLOOM_WORKER_QUEUES`:
 *
 *   pnpm worker                                 # drains the shared cloud queue
 *   STORYLOOM_WORKER_QUEUES=local:<userId> \
 *   STORYLOOM_MODE=local pnpm worker            # drains only that user's private queue
 *
 * Run it with `--env-file` (or an exported environment) because it does not go through
 * SvelteKit and therefore does not read `.env.storyloom-*` on its own.
 */
import { closeDb } from './lib/server/db/client';
import { getConfig } from './lib/server/config';
import { closeRedis } from './lib/server/queue/connection';
import { resolveQueueNames } from './lib/server/queue/names';
import { closeQueues } from './lib/server/queue/queues';
import { startWorkers } from './lib/server/queue/worker';

const config = getConfig();
const queueNames = resolveQueueNames(config.worker.queues);

console.log(`[worker] mode=${config.mode} storage=${config.storage.driver} queues=${queueNames.join(', ')}`);
if (config.mode === 'local' && queueNames.some((name) => name.endsWith('-cloud'))) {
  console.warn('[worker] this worker consumes the shared cloud queue while running in local mode: it will try to serve other accounts with this machine\'s runtimes.');
}

const running = startWorkers(queueNames);
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

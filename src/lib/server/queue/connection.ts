import IORedis from 'ioredis';
import { requireRedisUrl } from '../config';

const stateKey = Symbol.for('storyloom.redis');
const globalState = globalThis as typeof globalThis & { [stateKey]?: { url: string; connection: IORedis } };

/**
 * One shared connection for queue reads and live job state. BullMQ requires
 * `maxRetriesPerRequest: null` so its blocking commands are never aborted mid-wait.
 */
export function getRedis() {
  const url = requireRedisUrl();
  const existing = globalState[stateKey];
  if (existing && existing.url === url) return existing.connection;
  const connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // A queue that cannot reach Redis must fail the request rather than buffer forever.
    enableOfflineQueue: true,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000)
  });
  connection.on('error', (error) => console.error('[redis]', error.message));
  globalState[stateKey] = { url, connection };
  return connection;
}

export async function closeRedis() {
  const existing = globalState[stateKey];
  if (!existing) return;
  delete globalState[stateKey];
  await existing.connection.quit().catch(() => existing.connection.disconnect());
}

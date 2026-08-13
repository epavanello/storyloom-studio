import type { ExecutionTarget } from '../../core/schemas';

const PREFIX = 'storyloom';

/**
 * Cloud work is multi-tenant: any worker holding no local runtimes can drain it, using
 * each job's own bring-your-own key.
 */
export const CLOUD_QUEUE = `${PREFIX}-cloud`;

/**
 * Local work is single-tenant by construction. A user who wants inference on their own
 * machine runs a worker bound to their private queue, and nothing else is ever routed
 * there — which is also what keeps one user's machine from seeing another user's book.
 */
export function localQueueFor(userId: string) {
  return `${PREFIX}-local-${userId}`;
}

export function queueFor(target: ExecutionTarget, userId: string) {
  return target === 'local' ? localQueueFor(userId) : CLOUD_QUEUE;
}

export function targetOfQueue(name: string): ExecutionTarget {
  return name === CLOUD_QUEUE ? 'cloud' : 'local';
}

/**
 * Expands the operator-facing `STORYLOOM_WORKER_QUEUES` values (`cloud`,
 * `local:<userId>`, or a full queue name) into BullMQ queue names.
 */
export function resolveQueueNames(entries: string[]) {
  return entries.map((entry) => {
    const value = entry.trim();
    if (value === 'cloud') return CLOUD_QUEUE;
    if (value.startsWith('local:')) return localQueueFor(value.slice('local:'.length));
    return value;
  });
}

import type { QueueDriver } from './driver';

/**
 * A queue that accepts nothing, for a deployment that only reads.
 *
 * The read-only half of a split setup — the public site serving books whose media was
 * generated elsewhere — has no worker and no broker. Without this it would either need
 * a Redis it never uses, or crash the moment a page asked how deep the queue was.
 *
 * Job history still works: `jobsForUser` falls back to the database when the queue
 * reports no live state, so finished work generated on the other machine is visible.
 */
export function createDisabledQueue(name: string): QueueDriver {
  const refuse = () => new Error(
    'This deployment does not run generation. It reads books and media produced elsewhere; start a worker on the machine that owns the models instead.'
  );

  return {
    kind: 'none',
    name,

    async enqueue() {
      throw refuse();
    },
    async removeIfWaiting() {
      return false;
    },
    async snapshot() {
      return { name, waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, hasWorker: false };
    },
    async waitingPosition() {
      return null;
    },
    startWorker() {
      throw refuse();
    },

    // No live state to hold: everything this deployment shows comes from the database.
    async publishJobState() {},
    async readLiveJob() {
      return null;
    },
    async readLiveJobs() {
      return [];
    },
    async forgetLiveJob() {},
    async requestCancellation() {},
    async isCancellationRequested() {
      return false;
    },

    async close() {}
  };
}

import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../core/schemas';
import { createMemoryQueue } from './memory';
import type { JobPayload } from './driver';

function payload(jobId: string): JobPayload {
  return { jobId, userId: 'user-1', bookId: 'book-1', chapterId: 'chapter-1', characterId: null, kind: 'chapter', force: false };
}

function job(id: string, updatedAt: string, userId = 'user-1'): GenerationJob {
  return {
    schemaVersion: 1, id, kind: 'chapter', bookId: 'book-1', chapterId: 'chapter-1', characterId: null,
    force: false, userId, mode: 'mock', status: 'queued', queuePosition: null, attempts: 0,
    createdAt: updatedAt, updatedAt, startedAt: null, completedAt: null, error: null, steps: []
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('in-process queue', () => {
  it('reports depth and waiting position in submission order', async () => {
    const queue = createMemoryQueue('test');
    await queue.enqueue(payload('a'));
    await queue.enqueue(payload('b'));

    expect(await queue.waitingPosition('a')).toBe(1);
    expect(await queue.waitingPosition('b')).toBe(2);
    expect(await queue.waitingPosition('missing')).toBeNull();
    expect(await queue.snapshot()).toMatchObject({ waiting: 2, active: 0, hasWorker: false });
  });

  it('says it has no worker until one attaches, so a stalled queue is visible', async () => {
    const queue = createMemoryQueue('test');
    expect((await queue.snapshot()).hasWorker).toBe(false);
    const worker = queue.startWorker(async () => {}, 1);
    expect((await queue.snapshot()).hasWorker).toBe(true);
    await worker.stop();
    expect((await queue.snapshot()).hasWorker).toBe(false);
  });

  it('runs queued work and counts the outcome', async () => {
    const queue = createMemoryQueue('test');
    const seen: string[] = [];
    const worker = queue.startWorker(async (item) => {
      seen.push(item.jobId);
      if (item.jobId === 'boom') throw new Error('nope');
    }, 1);

    await queue.enqueue(payload('a'));
    await queue.enqueue(payload('boom'));
    await settle();
    await worker.stop();

    expect(seen).toEqual(['a', 'boom']);
    // A failing handler must not take the worker down with it.
    expect(await queue.snapshot()).toMatchObject({ waiting: 0, active: 0, completed: 1, failed: 1 });
  });

  it('drops a job that has not started and refuses one that has', async () => {
    const queue = createMemoryQueue('test');
    await queue.enqueue(payload('a'));
    expect(await queue.removeIfWaiting('a')).toBe(true);
    expect(await queue.removeIfWaiting('a')).toBe(false);
    expect((await queue.snapshot()).waiting).toBe(0);
  });

  it('carries a cancellation flag a running handler can observe', async () => {
    const queue = createMemoryQueue('test');
    expect(await queue.isCancellationRequested('a')).toBe(false);
    await queue.requestCancellation('a');
    expect(await queue.isCancellationRequested('a')).toBe(true);
  });

  it('keeps live job state per owner, newest first', async () => {
    const queue = createMemoryQueue('test');
    await queue.publishJobState(job('a', '2026-01-01T00:00:00.000Z'));
    await queue.publishJobState(job('b', '2026-01-02T00:00:00.000Z'));
    await queue.publishJobState(job('c', '2026-01-03T00:00:00.000Z', 'user-2'));

    expect((await queue.readLiveJobs('user-1', 10)).map((item) => item.id)).toEqual(['b', 'a']);
    // One account never sees another account's jobs.
    expect((await queue.readLiveJobs('user-2', 10)).map((item) => item.id)).toEqual(['c']);
    expect((await queue.readLiveJob('a'))?.id).toBe('a');

    await queue.forgetLiveJob({ id: 'a', userId: 'user-1' });
    expect(await queue.readLiveJob('a')).toBeNull();
  });

  it('stores a copy, so a later mutation of the caller\'s object cannot rewrite history', async () => {
    const queue = createMemoryQueue('test');
    const original = job('a', '2026-01-01T00:00:00.000Z');
    await queue.publishJobState(original);
    original.status = 'failed';
    expect((await queue.readLiveJob('a'))?.status).toBe('queued');
  });
});

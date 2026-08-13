import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end proof that a job survives the trip through Redis to a worker that shares
 * nothing with the producer except Postgres, Redis and object storage — which is exactly
 * the split between a cheap web box and a machine doing local inference.
 *
 * Skipped unless DATABASE_URL and REDIS_URL are present, so the default suite needs no
 * services. Start them with `docker compose -f docker-compose.dev.yml up -d`.
 */
const enabled = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const suite = enabled ? describe : describe.skip;

let dataDir = '';

suite('distributed generation pipeline', () => {
  let owner = '';
  let stranger = '';
  let bookId = '';
  let stop: () => Promise<void> = async () => {};

  // Imported lazily so the environment below is in place before any module reads it.
  let modules: {
    db: typeof import('./db/client');
    schema: typeof import('./db/schema');
    store: typeof import('./store');
    jobs: typeof import('./jobs');
    orchestrator: typeof import('./orchestrator');
    queueNames: typeof import('./queue/names');
    queues: typeof import('./queue/queues');
    worker: typeof import('./queue/worker');
    connection: typeof import('./queue/connection');
    accounts: typeof import('./accounts');
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'storyloom-pipeline-'));
    process.env.STORYLOOM_MODE = 'mock';
    process.env.STORAGE_DRIVER = 'fs';
    process.env.STORYLOOM_DATA_DIR = dataDir;
    process.env.STORYLOOM_ENCRYPTION_KEY = 'integration-encryption-key-long-enough-01';
    process.env.STORYLOOM_WORKER_MODE = 'external';

    modules = {
      db: await import('./db/client'),
      schema: await import('./db/schema'),
      store: await import('./store'),
      jobs: await import('./jobs'),
      orchestrator: await import('./orchestrator'),
      queueNames: await import('./queue/names'),
      queues: await import('./queue/queues'),
      worker: await import('./queue/worker'),
      connection: await import('./queue/connection'),
      accounts: await import('./accounts')
    };

    owner = `user-${randomUUID()}`;
    stranger = `user-${randomUUID()}`;
    const db = modules.db.getDb();
    await db.insert(modules.schema.user).values([
      { id: owner, name: 'Owner', email: `${owner}@example.test` },
      { id: stranger, name: 'Stranger', email: `${stranger}@example.test` }
    ]);
  }, 30_000);

  afterAll(async () => {
    await stop();
    if (modules) {
      const db = modules.db.getDb();
      for (const id of [owner, stranger]) {
        if (id) await db.delete(modules.schema.user).where(eq(modules.schema.user.id, id));
      }
      await modules.queues.closeQueues();
      await modules.connection.closeRedis();
      await modules.db.closeDb();
    }
    await rm(dataDir, { recursive: true, force: true });
  }, 30_000);

  it('imports a book against its owner', async () => {
    const book = await modules.orchestrator.ingestBook(owner, 'The Observatory.txt', new TextEncoder().encode(SAMPLE));
    bookId = book.id;
    expect(book.chapters.length).toBeGreaterThan(0);

    const listed = await modules.store.listBooks(owner);
    expect(listed.map((item) => item.id)).toContain(bookId);
    // The chapter text is deliberately absent from a library listing.
    expect(listed[0]).not.toHaveProperty('chapters');
  });

  it('hides one account\'s book from another account', async () => {
    expect(await modules.store.listBooks(stranger)).toHaveLength(0);
    await expect(modules.store.getManifest(stranger, bookId)).rejects.toThrow(modules.store.BookNotFoundError);
    await expect(modules.store.assertBookOwner(stranger, bookId)).rejects.toThrow();
    await expect(modules.store.deleteBook(stranger, bookId)).rejects.toThrow();
    // And the owner still has it after the failed deletion attempt.
    expect(await modules.store.getManifest(owner, bookId)).toBeTruthy();
  });

  it('refuses to queue a job for a book the requester does not own', async () => {
    await expect(modules.jobs.startGenerationJob(stranger, { kind: 'registry', bookId })).rejects.toThrow();
  });

  it('queues work without executing it, and reports it as waiting', async () => {
    const manifest = await modules.store.getManifest(owner, bookId);
    const job = await modules.jobs.startGenerationJob(owner, { kind: 'chapter', bookId, chapterId: manifest.chapters[0].id });
    expect(job.status).toBe('queued');
    expect(job.executionTarget).toBe('cloud');
    expect(job.queueName).toBe(modules.queueNames.CLOUD_QUEUE);

    const snapshot = await modules.queues.queueSnapshot(modules.queueNames.CLOUD_QUEUE);
    expect(snapshot.waiting + snapshot.active).toBeGreaterThan(0);

    // A second request for the same target joins the queued job instead of duplicating it.
    const again = await modules.jobs.startGenerationJob(owner, { kind: 'chapter', bookId, chapterId: manifest.chapters[0].id });
    expect(again.id).toBe(job.id);
  }, 30_000);

  it('runs the queued job on a separate worker and stores the render', async () => {
    const running = modules.worker.startWorkers([modules.queueNames.CLOUD_QUEUE]);
    stop = running.stop;

    const manifest = await modules.store.getManifest(owner, bookId);
    const chapterId = manifest.chapters[0].id;
    const finished = await waitFor(async () => {
      const [job] = await modules.jobs.jobsForUser(owner, { bookId });
      return job && (job.status === 'completed' || job.status === 'failed') ? job : null;
    }, 90_000);

    expect(finished.error).toBeNull();
    expect(finished.status).toBe('completed');
    expect(finished.steps.every((step) => step.status === 'completed')).toBe(true);

    const rendered = await modules.store.getRenderedChapter(bookId, chapterId);
    expect(rendered?.utterances.length).toBeGreaterThan(0);

    // Every artifact is addressed by a key under the owning book and its bytes are real.
    const audio = rendered!.utterances[0].audio;
    expect(audio.key.startsWith(`books/${bookId}/`)).toBe(true);
    expect((await modules.store.readArtifact(audio)).byteLength).toBeGreaterThan(0);
  }, 120_000);

  it('keeps a bring-your-own key unreadable in the database', async () => {
    await modules.accounts.setProviderCredential(owner, 'openrouter', 'sk-or-v1-integration-secret');
    const db = modules.db.getDb();
    const [row] = await db
      .select()
      .from(modules.schema.providerCredentials)
      .where(eq(modules.schema.providerCredentials.userId, owner));
    expect(row.ciphertext).not.toContain('integration-secret');
    expect(row.hint).toBe('••••cret');
    expect(await modules.accounts.getProviderCredential(owner, 'openrouter')).toBe('sk-or-v1-integration-secret');
    // Another account never resolves someone else's key.
    expect(await modules.accounts.getProviderCredential(stranger, 'openrouter')).toBeNull();
  });

  it('removes objects and rows together when the owner deletes a book', async () => {
    const rendered = await modules.store.getRenderedChapter(bookId, (await modules.store.getManifest(owner, bookId)).chapters[0].id);
    const audio = rendered!.utterances[0].audio;
    await modules.store.deleteBook(owner, bookId);
    await expect(modules.store.getManifest(owner, bookId)).rejects.toThrow();
    await expect(modules.store.readArtifact(audio)).rejects.toThrow();
  }, 30_000);
});

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the job to finish');
}

const SAMPLE = `Capitolo I

The rain had polished every stone in Via delle Rose when Anna reached the old observatory. She stopped beneath the copper dome and unfolded the letter for the third time.

"Midnight. Come alone," it read.

Marco was already waiting inside, a lantern in one hand and a brass key in the other. "You came," he whispered.

Anna closed the door behind her. Above them, the telescope began to turn by itself.`;

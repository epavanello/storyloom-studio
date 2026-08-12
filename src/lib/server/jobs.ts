import { randomUUID } from 'node:crypto';
import type { GenerationJob, GenerationJobStep } from '$lib/core/schemas';
import { getConfig } from './config';
import { prepareChapter, prepareRegistry, regenerateChapterAudio, regenerateCharacterReference, type ProgressUpdate } from './orchestrator';
import { getManifest, listBooks, listGenerationJobs, saveGenerationJob } from './store';

type JobRequest =
  | { kind: 'registry'; bookId: string }
  | { kind: 'chapter'; bookId: string; chapterId: string; force?: boolean }
  | { kind: 'chapter-audio'; bookId: string; chapterId: string }
  | { kind: 'character-reference'; bookId: string; characterId: string };

type ManagerState = {
  initialized?: Promise<void>;
  startTail: Promise<void>;
  localTail: Promise<void>;
  localQueue: string[];
  jobs: Map<string, GenerationJob>;
  executions: Map<string, Promise<void>>;
};

const managerSymbol = Symbol.for('storyloom.generation-job-manager');
const globalWithManager = globalThis as typeof globalThis & { [managerSymbol]?: ManagerState };
const state: ManagerState = globalWithManager[managerSymbol] ??= {
  startTail: Promise.resolve(),
  localTail: Promise.resolve(),
  localQueue: [] as string[],
  jobs: new Map<string, GenerationJob>(),
  executions: new Map<string, Promise<void>>()
};

function step(id: string, label: string): GenerationJobStep {
  return { id, label, status: 'pending', completed: 0, total: 1 };
}

function stepsFor(kind: GenerationJob['kind']) {
  if (kind === 'character-reference') return [step('character-reference', 'Regenerate illustrated character reference')];
  if (kind === 'chapter-audio') return [step('speech', 'Regenerate narration and dialogue'), step('alignment', 'Realign words and audio')];
  return kind === 'registry'
    ? [step('registry-analysis', 'Read chapters and build continuity registries'), step('registry-references', 'Generate selected continuity references')]
    : [
        step('registry', 'Lock character, voice, and world identities'),
        step('plan', 'Direct the chapter'),
        step('speech', 'Generate narration and dialogue'),
        step('alignment', 'Synchronize words and audio'),
        step('visuals', 'Stage visual scenes')
      ];
}

function isActive(job: GenerationJob) {
  return job.status === 'queued' || job.status === 'running';
}

function sameTarget(job: GenerationJob, request: JobRequest) {
  return job.kind === request.kind && job.bookId === request.bookId
    && (request.kind === 'registry'
      || (request.kind === 'chapter' || request.kind === 'chapter-audio') && job.chapterId === request.chapterId
      || request.kind === 'character-reference' && job.characterId === request.characterId);
}

function serializedMode() {
  const config = getConfig();
  return config.mode === 'local'
    || config.mode === 'hybrid' && Object.values(config.policies).some((policy) => policy !== 'cloud-only');
}

async function initialize() {
  if (!state.initialized) state.initialized = (async () => {
    const now = new Date().toISOString();
    for (const book of await listBooks()) {
      for (const job of await listGenerationJobs(book.id)) {
        if (!isActive(job)) continue;
        job.status = 'failed';
        job.queuePosition = null;
        job.updatedAt = now;
        job.completedAt = now;
        job.error = 'Generation was interrupted because the Storyloom server restarted. Start it again to resume from cached artifacts.';
        const running = job.steps.find((candidate) => candidate.status === 'running');
        if (running) running.status = 'failed';
        await saveGenerationJob(job);
      }
    }
  })();
  await state.initialized;
}

async function updateJob(jobId: string, mutate: (job: GenerationJob) => void) {
  const job = state.jobs.get(jobId);
  if (!job) throw new Error(`Unknown active generation job ${jobId}`);
  mutate(job);
  job.updatedAt = new Date().toISOString();
  await saveGenerationJob(job);
  return job;
}

async function updateQueuePositions() {
  await Promise.all(state.localQueue.map((jobId, index) => updateJob(jobId, (job) => {
    job.queuePosition = index + 1;
  })));
}

async function report(jobId: string, update: ProgressUpdate) {
  await updateJob(jobId, (job) => {
    const target = job.steps.find((candidate) => candidate.id === update.stepId);
    if (!target) return;
    if (update.status) target.status = update.status;
    if (update.completed !== undefined) target.completed = update.completed;
    if (update.total !== undefined) target.total = update.total;
    if (update.detail !== undefined) target.detail = update.detail;
  });
}

async function runJob(jobId: string) {
  const queuedIndex = state.localQueue.indexOf(jobId);
  if (queuedIndex >= 0) {
    state.localQueue.splice(queuedIndex, 1);
    await updateQueuePositions();
  }
  const job = await updateJob(jobId, (current) => {
    current.status = 'running';
    current.queuePosition = null;
    current.startedAt = new Date().toISOString();
  });
  try {
    if (job.kind === 'registry') await prepareRegistry(job.bookId, (update) => report(job.id, update));
    else if (job.kind === 'character-reference') await regenerateCharacterReference(job.bookId, job.characterId!, (update) => report(job.id, update));
    else if (job.kind === 'chapter-audio') await regenerateChapterAudio(job.bookId, job.chapterId!, job.id, (update) => report(job.id, update));
    else await prepareChapter(job.bookId, job.chapterId!, (update) => report(job.id, update), { force: job.force, generationId: job.id });
    await updateJob(job.id, (current) => {
      current.status = 'completed';
      current.completedAt = new Date().toISOString();
      for (const item of current.steps) {
        item.status = 'completed';
        item.completed = item.total;
      }
    });
  } catch (error) {
    await updateJob(job.id, (current) => {
      current.status = 'failed';
      current.completedAt = new Date().toISOString();
      current.error = error instanceof Error ? error.message : 'Generation failed';
      const running = current.steps.find((candidate) => candidate.status === 'running');
      if (running) running.status = 'failed';
    });
  } finally {
    state.executions.delete(job.id);
    state.jobs.delete(job.id);
  }
}

async function startUnlocked(request: JobRequest) {
  await getManifest(request.bookId);
  const config = getConfig();
  const requiresCloud = config.mode === 'cloud'
    || config.mode === 'hybrid' && Object.values(config.policies).some((policy) => policy === 'cloud-only');
  if (requiresCloud && !config.openRouterApiKey) {
    throw new Error(`${config.mode === 'hybrid' ? 'Hybrid' : 'Cloud'} mode needs OPENROUTER_API_KEY`);
  }
  const previous = await listGenerationJobs(request.bookId);
  const duplicate = previous.find((job) => isActive(job) && sameTarget(job, request));
  if (duplicate) return duplicate;

  const now = new Date().toISOString();
  const job: GenerationJob = {
    schemaVersion: 1,
    id: `job-${randomUUID()}`,
    kind: request.kind,
    bookId: request.bookId,
    chapterId: request.kind === 'chapter' || request.kind === 'chapter-audio' ? request.chapterId : undefined,
    characterId: request.kind === 'character-reference' ? request.characterId : undefined,
    force: request.kind === 'chapter' ? request.force ?? false : false,
    mode: config.mode,
    status: serializedMode() ? 'queued' : 'running',
    queuePosition: null,
    createdAt: now,
    updatedAt: now,
    steps: stepsFor(request.kind)
  };
  state.jobs.set(job.id, job);
  await saveGenerationJob(job);

  let execution: Promise<void>;
  if (serializedMode()) {
    state.localQueue.push(job.id);
    await updateQueuePositions();
    execution = state.localTail.then(() => runJob(job.id));
    state.localTail = execution.catch(() => {});
  } else {
    execution = runJob(job.id);
  }
  state.executions.set(job.id, execution);
  void execution.catch(() => {});
  return job;
}

export async function startGenerationJob(request: JobRequest) {
  await initialize();
  let release!: () => void;
  const previous = state.startTail;
  state.startTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await startUnlocked(request);
  } finally {
    release();
  }
}

export async function jobsForBook(bookId: string) {
  await initialize();
  await getManifest(bookId);
  return (await listGenerationJobs(bookId)).slice(0, 30);
}

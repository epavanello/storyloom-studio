import { getConfig } from '../config';
import { buildRunContext } from '../context';
import { finalize, JobCancelledError, markJobActive, recoverInterruptedJobs, reportJobProgress } from '../jobs';
import { generateBookCoverOnly, prepareChapter, prepareRegistry, regenerateChapterAudio, regenerateCharacterReference } from '../orchestrator';
import { describeGenerationFailure } from '../providers/failures';
import { generateStory } from '../story';
import { getStorage } from '../storage/index';
import { getQueueDriver, type JobPayload, type RunningWorker } from './index';

/**
 * Runs one queued generation job to completion.
 *
 * This is the only place that knows how a queue entry maps onto the orchestrator:
 * everything else — routes, the dashboard, the standalone worker — talks about jobs.
 */
async function execute(payload: JobPayload) {
  const { jobId, userId, bookId, chapterId, characterId, kind, force } = payload;
  const queue = getQueueDriver();
  if (await queue.isCancellationRequested(jobId)) {
    await finalize(jobId, 'cancelled', { error: 'Cancelled before it started' });
    return;
  }

  await markJobActive(jobId);
  const context = await buildRunContext(userId, bookId, jobId);
  const report = (update: Parameters<typeof reportJobProgress>[1]) => reportJobProgress(jobId, update);

  try {
    // Fail before spending anything. Misconfigured storage would otherwise surface at
    // the first artifact write, which is after a paid model call and, locally, after
    // minutes of speech synthesis.
    getStorage();
    if (kind === 'story') await generateStory(context, report);
    else if (kind === 'registry') await prepareRegistry(context, report);
    else if (kind === 'character-reference') await regenerateCharacterReference(context, characterId!, report);
    else if (kind === 'book-cover') await generateBookCoverOnly(context, report);
    else if (kind === 'chapter-audio') await regenerateChapterAudio(context, chapterId!, jobId, report);
    else await prepareChapter(context, chapterId!, report, { force, generationId: jobId });
    await finalize(jobId, 'completed');
  } catch (error) {
    if (error instanceof JobCancelledError) {
      await finalize(jobId, 'cancelled', { error: 'Cancelled while running' });
      return;
    }
    await finalize(jobId, 'failed', { error: describeGenerationFailure(error) });
    // Rethrown so the queue records the failure too and the snapshot stays truthful.
    throw error;
  }
}

/** Attaches a consumer to the deployment's queue. */
export function startWorker(): RunningWorker {
  const config = getConfig();
  const running = getQueueDriver().startWorker(execute, config.worker.concurrency);
  // Recovery runs after the worker is listening, so anything re-enqueued is picked up
  // immediately rather than waiting for the next request.
  void recoverInterruptedJobs().catch((error) => {
    console.error('[queue] could not recover interrupted jobs:', error instanceof Error ? error.message : error);
  });
  return running;
}

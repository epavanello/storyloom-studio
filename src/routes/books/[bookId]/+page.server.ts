import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { jobsForUser, queueHealth } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';
import { BookNotFoundError, getManifest, getRenderedChapter } from '$lib/server/store';
import { getVoiceCandidates } from '$lib/server/voice-catalog';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requireUser(locals);
  let book;
  try {
    book = await getManifest(user.id, params.bookId);
  } catch (cause) {
    // Only a missing or unowned book is a 404; a damaged render must not be disguised
    // as one, or the reader is told the book does not exist.
    if (cause instanceof BookNotFoundError) error(404, 'Book not found');
    throw cause;
  }

  const config = getConfig();
  const chapterId = url.searchParams.get('chapter') ?? book.chapters[0]?.id;
  const [rendered, jobs, queue, voiceCandidates] = await Promise.all([
    chapterId ? getRenderedChapter(book.id, chapterId) : Promise.resolve(null),
    jobsForUser(user.id, { bookId: book.id, limit: 20 }),
    queueHealth().catch(() => null),
    config.technicalUi && config.localTtsEngine === 'chatterbox-v3' ? getVoiceCandidates() : Promise.resolve([])
  ]);

  const usesCloud = (capability: keyof typeof config.policies) => config.mode === 'cloud'
    || config.mode === 'hybrid' && ['cloud-only', 'cloud-preferred'].includes(config.policies[capability]);
  const serialized = config.mode === 'local'
    || config.mode === 'hybrid' && Object.values(config.policies).some((policy) => policy !== 'cloud-only');

  return {
    book,
    chapterId,
    rendered,
    jobs,
    queue,
    voiceCandidates,
    workerMode: config.worker.mode,
    runtime: {
      mode: config.mode,
      technicalUi: config.technicalUi,
      serialized,
      text: usesCloud('text') ? config.openRouterLlmModel : config.localLlmModel,
      speech: usesCloud('tts') ? config.openRouterTtsModel : config.localTtsEngine === 'chatterbox-v3' ? 'Chatterbox Multilingual V3' : config.localTtsModel,
      image: usesCloud('image') ? config.openRouterImageModel : config.localImageModel,
      alignment: usesCloud('alignment') ? 'proportional · approximate' : config.localAlignerBaseUrl ? 'Qwen3 ForcedAligner · exact' : 'proportional · approximate'
    }
  };
};

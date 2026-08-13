import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { jobsForUser, queueHealth } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';
import { BookNotFoundError, getManifest, getRenderedChapter } from '$lib/server/store';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requireUser(locals);
  let book;
  try {
    book = await getManifest(user.id, params.bookId);
  } catch (cause) {
    if (cause instanceof BookNotFoundError) error(404, 'Book not found');
    throw cause;
  }

  const chapterId = url.searchParams.get('chapter') ?? book.chapters[0]?.id;
  const [rendered, jobs, queue] = await Promise.all([
    chapterId ? getRenderedChapter(book.id, chapterId) : Promise.resolve(null),
    jobsForUser(user.id, { bookId: book.id, limit: 20 }),
    queueHealth().catch(() => null)
  ]);

  const config = getConfig();
  const cloud = config.mode === 'cloud';
  return {
    book,
    chapterId,
    rendered,
    jobs,
    queue,
    workerMode: config.worker.mode,
    runtime: {
      mode: config.mode,
      text: cloud ? config.openRouterLlmModel : config.localLlmModel,
      speech: cloud ? config.openRouterTtsModel : config.localTtsModel,
      image: cloud ? config.openRouterImageModel : config.localImageModel,
      alignment: cloud ? 'proportional · approximate' : config.localAlignerBaseUrl ? 'Qwen3 ForcedAligner · exact' : 'proportional · approximate'
    }
  };
};

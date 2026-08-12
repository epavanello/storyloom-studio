import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getManifest, getRenderedChapter } from '$lib/server/store';
import { getConfig } from '$lib/server/config';
import { jobsForBook } from '$lib/server/jobs';

export const load: PageServerLoad = async ({ params, url }) => {
  try {
    const book = await getManifest(params.bookId);
    const chapterId = url.searchParams.get('chapter') ?? book.chapters[0]?.id;
    const rendered = chapterId ? await getRenderedChapter(book.id, chapterId) : null;
    const jobs = await jobsForBook(book.id);
    const config = getConfig();
    const usesCloud = (capability: keyof typeof config.policies) => config.mode === 'cloud'
      || config.mode === 'hybrid' && ['cloud-only', 'cloud-preferred'].includes(config.policies[capability]);
    const serialized = config.mode === 'local'
      || config.mode === 'hybrid' && Object.values(config.policies).some((policy) => policy !== 'cloud-only');
    return {
      book,
      chapterId,
      rendered,
      jobs,
      runtime: {
        mode: config.mode,
        serialized,
        text: usesCloud('text') ? config.openRouterLlmModel : config.localLlmModel,
        speech: usesCloud('tts') ? config.openRouterTtsModel : config.localTtsModel,
        image: usesCloud('image') ? config.openRouterImageModel : config.localImageModel,
        alignment: usesCloud('alignment') ? 'proportional · approximate' : config.localAlignerBaseUrl ? 'Qwen3 ForcedAligner · exact' : 'proportional · approximate'
      }
    };
  } catch {
    error(404, 'Book not found');
  }
};

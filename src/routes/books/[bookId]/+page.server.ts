import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getManifest, getRenderedChapter } from '$lib/server/store';

export const load: PageServerLoad = async ({ params, url }) => {
  try {
    const book = await getManifest(params.bookId);
    const chapterId = url.searchParams.get('chapter') ?? book.chapters[0]?.id;
    const rendered = chapterId ? await getRenderedChapter(book.id, chapterId) : null;
    return { book, chapterId, rendered };
  } catch {
    error(404, 'Book not found');
  }
};


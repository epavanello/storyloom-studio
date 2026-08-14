import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startGenerationJob } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';
import { BookNotFoundError, getManifest } from '$lib/server/store';

export const POST: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  try {
    const manifest = await getManifest(user.id, params.bookId);
    if (manifest.origin.kind !== 'generated') return json({ error: 'This book was imported and cannot be rewritten by the story writer.' }, { status: 400 });
    if (manifest.origin.status === 'ready' && manifest.chapters.length === manifest.origin.requestedChapterCount) {
      return json({ error: 'The complete source story is already immutable and ready.' }, { status: 409 });
    }
    return json(await startGenerationJob(user.id, { kind: 'story', bookId: params.bookId }), { status: 202 });
  } catch (error) {
    if (error instanceof BookNotFoundError) return json({ error: 'Book not found' }, { status: 404 });
    return json({ error: error instanceof Error ? error.message : 'The story could not be queued.' }, { status: 400 });
  }
};

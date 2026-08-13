import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertNoActiveJobs } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';
import { trashBook } from '$lib/server/store';

/** Recoverable deletion: the book leaves the library, its rows and artifacts remain. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  try {
    await assertNoActiveJobs(user.id, params.bookId);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The book still has active work' }, { status: 409 });
  }
  try {
    await trashBook(user.id, params.bookId);
    return json({ deleted: true, recoverable: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Book deletion failed' }, { status: 400 });
  }
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jobsForBook } from '$lib/server/jobs';
import { trashBook } from '$lib/server/store';

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const jobs = await jobsForBook(params.bookId);
    if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
      return json({ error: 'Wait for active generation jobs before deleting this book.' }, { status: 409 });
    }
    await trashBook(params.bookId);
    return json({ deleted: true, recoverable: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Book deletion failed' }, { status: 500 });
  }
};

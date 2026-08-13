import type { PageServerLoad } from './$types';
import { jobsForUser, queueSnapshotsForUser } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';
import { listBooks } from '$lib/server/store';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const [jobs, queues, books] = await Promise.all([
    jobsForUser(user.id, { limit: 60 }),
    queueSnapshotsForUser(user.id).catch(() => []),
    listBooks(user.id)
  ]);
  return {
    jobs,
    queues,
    titles: Object.fromEntries(books.map((book) => [book.id, book.title]))
  };
};

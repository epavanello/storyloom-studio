import type { PageServerLoad } from './$types';
import { getConfig } from '$lib/server/config';
import { jobsForUser, queueHealth } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';
import { listBooks } from '$lib/server/store';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const config = getConfig();
  const [jobs, queue, books] = await Promise.all([
    jobsForUser(user.id, { limit: 60 }),
    queueHealth().catch(() => null),
    listBooks(user.id)
  ]);
  return {
    jobs,
    queue,
    deployment: { mode: config.mode, workerMode: config.worker.mode },
    titles: Object.fromEntries(books.map((book) => [book.id, book.title]))
  };
};

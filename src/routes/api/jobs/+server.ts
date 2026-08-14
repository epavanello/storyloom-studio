import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jobsForUser, queueHealth } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';

/**
 * The polling endpoint behind the job views. Live state is served from Redis, so an open
 * tab refreshing every couple of seconds costs no database compute.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireUser(locals);
  const bookId = url.searchParams.get('bookId') ?? undefined;
  const [jobs, queue] = await Promise.all([
    jobsForUser(user.id, { bookId, limit: Number(url.searchParams.get('limit') ?? 50) }),
    queueHealth()
  ]);
  return json({ jobs, queue }, { headers: { 'cache-control': 'no-store' } });
};

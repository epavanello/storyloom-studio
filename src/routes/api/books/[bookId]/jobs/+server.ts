import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { jobsForBook } from '$lib/server/jobs';

export const GET: RequestHandler = async ({ params }) => {
  try {
    return json(await jobsForBook(params.bookId), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not read generation jobs' }, { status: 404 });
  }
};

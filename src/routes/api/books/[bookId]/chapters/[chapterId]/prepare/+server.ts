import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prepareChapter } from '$lib/server/orchestrator';

export const POST: RequestHandler = async ({ params }) => {
  try { return json(await prepareChapter(params.bookId, params.chapterId)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Chapter generation failed' }, { status: 500 }); }
};


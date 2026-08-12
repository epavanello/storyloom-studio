import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startGenerationJob } from '$lib/server/jobs';

export const POST: RequestHandler = async ({ params, url }) => {
  try { return json(await startGenerationJob({ kind: 'chapter', bookId: params.bookId, chapterId: params.chapterId, force: url.searchParams.get('force') === 'true' }), { status: 202 }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Chapter generation failed' }, { status: 500 }); }
};

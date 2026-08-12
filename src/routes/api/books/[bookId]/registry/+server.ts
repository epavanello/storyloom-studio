import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startGenerationJob } from '$lib/server/jobs';

export const POST: RequestHandler = async ({ params }) => {
  try { return json(await startGenerationJob({ kind: 'registry', bookId: params.bookId }), { status: 202 }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Registry generation failed' }, { status: 500 }); }
};

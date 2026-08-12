import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prepareRegistry } from '$lib/server/orchestrator';

export const POST: RequestHandler = async ({ params }) => {
  try { return json(await prepareRegistry(params.bookId)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Registry generation failed' }, { status: 500 }); }
};


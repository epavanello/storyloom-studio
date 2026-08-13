import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startGenerationJob } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  try {
    return json(
      await startGenerationJob(user.id, { kind: 'chapter', bookId: params.bookId, chapterId: params.chapterId }),
      { status: 202 }
    );
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Chapter generation failed' }, { status: 400 });
  }
};

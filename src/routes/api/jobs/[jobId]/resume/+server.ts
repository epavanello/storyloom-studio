import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resumeGenerationJob } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';

/**
 * Puts a failed job back on the queue under its own id, so its stored plan and already
 * synthesized passages are reused instead of regenerated.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  try {
    return json(await resumeGenerationJob(user.id, params.jobId));
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Could not resume the job' }, { status: 400 });
  }
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelJob, deleteJobRecord, getJob } from '$lib/server/jobs';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  const job = await getJob(user.id, params.jobId);
  if (!job) error(404, 'Job not found');
  return json(job, { headers: { 'cache-control': 'no-store' } });
};

/** Cancels a queued or running job. A running job stops at its next step boundary. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  try {
    return json(await cancelJob(user.id, params.jobId));
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Could not cancel the job' }, { status: 400 });
  }
};

/** Removes a finished job from the history. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  try {
    await deleteJobRecord(user.id, params.jobId);
    return new Response(null, { status: 204 });
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : 'Could not remove the job' }, { status: 400 });
  }
};

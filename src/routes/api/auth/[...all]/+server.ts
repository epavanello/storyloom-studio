import type { RequestHandler } from './$types';
import { getAuth } from '$lib/server/auth';

/** better-auth owns sign-in, sign-up, OAuth callbacks and session refresh under /api/auth. */
const handler: RequestHandler = ({ request }) => getAuth().handler(request);

export const GET = handler;
export const POST = handler;

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  const requestedNext = url.searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';
  const verificationError = url.searchParams.get('error');
  if (!verificationError && locals.user?.emailVerified) redirect(303, next);
  return { verificationError, next };
};

import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { enabledSocialProviders } from '$lib/server/auth';
import { getConfig } from '$lib/server/config';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const requestedNext = url.searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';
  // Recovery and verification-result pages remain reachable with a session; only the
  // entry forms become irrelevant after authentication.
  if (locals.user && (url.pathname === '/auth/sign-in' || url.pathname === '/auth/sign-up')) redirect(303, next);
  return {
    providers: enabledSocialProviders(),
    allowSignUp: getConfig().auth.allowSignUp,
    requireEmailVerification: getConfig().auth.requireEmailVerification,
    mailEnabled: Boolean(getConfig().auth.resendApiKey && getConfig().auth.emailFrom),
    next
  };
};

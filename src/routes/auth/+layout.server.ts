import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { enabledSocialProviders } from '$lib/server/auth';
import { getConfig } from '$lib/server/config';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // Someone already signed in has no reason to see the sign-in form.
  if (locals.user) redirect(303, url.searchParams.get('next') ?? '/');
  return {
    providers: enabledSocialProviders(),
    allowSignUp: getConfig().auth.allowSignUp,
    next: url.searchParams.get('next') ?? '/'
  };
};

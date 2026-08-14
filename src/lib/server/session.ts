import { error } from '@sveltejs/kit';

/**
 * Every route that reads or writes user data goes through this. `hooks.server.ts`
 * already blocks anonymous requests, so reaching here without a user means a route was
 * added under a public prefix by mistake — which should fail loudly, not leak.
 */
export function requireUser(locals: App.Locals) {
  if (!locals.user) error(401, 'Sign in to continue');
  return locals.user;
}

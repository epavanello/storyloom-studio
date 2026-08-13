import type { LayoutServerLoad } from './$types';

/** The signed-in account is available to every page and component. */
export const load: LayoutServerLoad = async ({ locals }) => ({ user: locals.user });

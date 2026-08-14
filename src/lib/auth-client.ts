import { createAuthClient } from 'better-auth/svelte';

/**
 * Browser-side auth. Sign-in and sign-up go straight to /api/auth so better-auth sets
 * and refreshes the session cookie itself, instead of a form action re-implementing it.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;

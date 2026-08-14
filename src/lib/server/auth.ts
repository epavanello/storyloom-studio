import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getConfig } from './config';
import { getDb } from './db/client';
import { schema } from './db/schema';

const stateKey = Symbol.for('storyloom.auth');
const globalState = globalThis as typeof globalThis & { [stateKey]?: { signature: string; auth: ReturnType<typeof create> } };

function create() {
  const config = getConfig();
  if (!config.auth.secret) {
    throw new Error('BETTER_AUTH_SECRET is not set. Sessions cannot be signed without it. Generate one with `openssl rand -base64 32`.');
  }

  // Closing registration has to cover OAuth too: without this a social login would still
  // create an account for any stranger who happens to have a GitHub or Google account.
  const disableSignUp = !config.auth.allowSignUp;

  const social: Record<string, { clientId: string; clientSecret: string; disableSignUp: boolean }> = {};
  // A provider is only advertised when it is actually configured, so a deployment never
  // shows a sign-in button that cannot complete.
  if (config.auth.github.clientId && config.auth.github.clientSecret) social.github = { ...config.auth.github, disableSignUp };
  if (config.auth.google.clientId && config.auth.google.clientSecret) social.google = { ...config.auth.google, disableSignUp };

  return betterAuth({
    appName: 'Storyloom Studio',
    secret: config.auth.secret,
    baseURL: config.publicUrl,
    trustedOrigins: [config.publicUrl, ...config.auth.trustedOrigins],
    database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      minPasswordLength: 10
    },
    socialProviders: social,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        // Sessions are read on every request. Caching the verified session in a signed
        // cookie for a minute keeps a serverless database from being woken by page loads.
        enabled: true,
        maxAge: 60
      }
    },
    advanced: {
      cookiePrefix: 'storyloom'
    }
  });
}

export function getAuth() {
  const config = getConfig();
  const signature = JSON.stringify(config.auth) + config.publicUrl + config.databaseUrl;
  const existing = globalState[stateKey];
  if (existing && existing.signature === signature) return existing.auth;
  const auth = create();
  globalState[stateKey] = { signature, auth };
  return auth;
}

/** Which social providers the sign-in page should offer. */
export function enabledSocialProviders() {
  const { auth } = getConfig();
  return {
    github: Boolean(auth.github.clientId && auth.github.clientSecret),
    google: Boolean(auth.google.clientId && auth.google.clientSecret)
  };
}

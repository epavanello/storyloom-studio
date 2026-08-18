import { env } from '$env/dynamic/private';
import { error, redirect, type Handle } from '@sveltejs/kit';

// The standalone worker reads plain `process.env`, while SvelteKit resolves .env files
// through `$env/dynamic/private`. Copying one into the other at boot means both
// entrypoints observe exactly the same configuration.
for (const [key, value] of Object.entries(env)) {
  if (value !== undefined && process.env[key] === undefined) process.env[key] = value;
}

const { getConfig } = await import('$lib/server/config');
const { getAuth } = await import('$lib/server/auth');

/** Paths reachable without a session. Everything else is per-user data. */
const PUBLIC_PATHS = new Set(['/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/llm.txt', '/site.webmanifest', '/og.png']);
const PUBLIC_PREFIXES = ['/auth', '/api/auth'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.has(pathname)
    || PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

startInlineWorker();

/**
 * Runs the queue consumer inside the web process. This is the whole point of the
 * parametric worker: a single-box deployment sets `STORYLOOM_WORKER_MODE=inline`, while
 * a deployment whose heavy work happens on another machine sets `external` here and
 * starts `pnpm worker` over there instead.
 */
function startInlineWorker() {
  const stateKey = Symbol.for('storyloom.inline-worker');
  const globalState = globalThis as typeof globalThis & { [stateKey]?: boolean };
  if (globalState[stateKey]) return;

  const config = getConfig();
  if (config.worker.mode !== 'inline') {
    console.log(`[web] worker mode ${config.worker.mode}: this process does not execute jobs`);
    return;
  }
  globalState[stateKey] = true;

  void (async () => {
    try {
      const [{ startWorker }, { getQueueDriver }] = await Promise.all([
        import('$lib/server/queue/worker'),
        import('$lib/server/queue/index')
      ]);
      startWorker();
      console.log(`[web] inline worker started on the ${getQueueDriver().kind} queue`);
    } catch (cause) {
      // A web server that cannot start its worker still serves the library and the job
      // history; it just cannot execute new work, which the dashboard reports.
      console.error('[web] inline worker failed to start:', cause instanceof Error ? cause.message : cause);
    }
  })();
}

export const handle: Handle = async ({ event, resolve }) => {
  const session = await getAuth()
    .api.getSession({ headers: event.request.headers })
    .catch(() => null);

  event.locals.user = session?.user ? { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: session.user.emailVerified, image: session.user.image ?? null } : null;
  event.locals.session = session?.session ? { id: session.session.id, expiresAt: new Date(session.session.expiresAt).toISOString() } : null;

  if (!event.locals.user && !isPublic(event.url.pathname)) {
    if (event.url.pathname.startsWith('/api/')) error(401, 'Sign in to use this endpoint');
    const next = `${event.url.pathname}${event.url.search}`;
    redirect(303, `/auth/sign-in?next=${encodeURIComponent(next)}`);
  }

  return resolve(event);
};

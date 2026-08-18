import { getProviderCredential } from './accounts';
import { getConfig, type AppConfig, type RuntimeMode } from './config';

/**
 * Everything a generation run needs that is specific to *whose* run it is. Provider
 * credentials belong to the requesting user, not to the process, so they travel with
 * the context instead of being read from the environment inside an adapter.
 */
export type RunContext = {
  userId: string;
  bookId: string;
  jobId: string | null;
  mode: RuntimeMode;
  policies: AppConfig['policies'];
  credentials: { openRouterApiKey: string };
};

export function selectOpenRouterKey(
  mode: AppConfig['openRouterKeyMode'],
  accountKey: string | null,
  sharedKey: string
) {
  return mode === 'account' ? (accountKey ?? '') : sharedKey;
}

export async function buildRunContext(userId: string, bookId: string, jobId: string | null = null): Promise<RunContext> {
  const config = getConfig();
  // Public deployments must never fall back to an operator key: a configuration error
  // must fail closed instead of silently charging the service owner. Conversely, a
  // shared self-host deliberately uses one environment key for every local account.
  // Shared mode does not even read or decrypt an account credential. This keeps the
  // operator-funded path independent from any stale personal key rows.
  const accountKey = config.openRouterKeyMode === 'account'
    ? await getProviderCredential(userId, 'openrouter')
    : null;
  const openRouterApiKey = selectOpenRouterKey(config.openRouterKeyMode, accountKey, config.openRouterApiKey);
  return {
    userId,
    bookId,
    jobId,
    mode: config.mode,
    policies: config.policies,
    credentials: { openRouterApiKey }
  };
}

/**
 * Explains why a run cannot start, before any expensive work or partial artifact is
 * produced. Returns null when the context is usable.
 */
export function describeMissingCredentials(context: RunContext) {
  if (context.mode === 'mock' || context.mode === 'local') return null;
  const cloudPolicies = Object.values(context.policies).some((policy) => policy !== 'local-required');
  if (!cloudPolicies) return null;
  if (context.credentials.openRouterApiKey) return null;
  return 'This run needs an OpenRouter key. Add yours under Settings, or switch the capability policies to local-required.';
}

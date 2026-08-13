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

export async function buildRunContext(userId: string, bookId: string, jobId: string | null = null): Promise<RunContext> {
  const config = getConfig();
  // A user's own key wins. The environment key is the self-hosted single-tenant case,
  // where the operator and the user are the same person.
  const openRouterApiKey = (await getProviderCredential(userId, 'openrouter')) ?? config.openRouterApiKey;
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

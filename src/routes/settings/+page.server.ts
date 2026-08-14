import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deleteProviderCredential, listCredentialHints, setProviderCredential } from '$lib/server/accounts';
import { getConfig } from '$lib/server/config';
import { queueHealth } from '$lib/server/jobs';
import { getQueueDriver } from '$lib/server/queue/index';
import { requireUser } from '$lib/server/session';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const config = getConfig();
  const [credentials, queue] = await Promise.all([
    listCredentialHints(user.id),
    queueHealth().catch(() => null)
  ]);
  return {
    credentials,
    queue,
    deployment: {
      mode: config.mode,
      storage: config.storage.driver,
      workerMode: config.worker.mode,
      queueDriver: getQueueDriver().kind,
      hasPlatformKey: Boolean(config.openRouterApiKey),
      /** Whether a cloud key is used at all on this deployment. */
      usesCloud: Object.values(config.policies).some((policy) => policy !== 'local-required') && config.mode !== 'mock' && config.mode !== 'local'
    }
  };
};

export const actions: Actions = {
  saveKey: async ({ locals, request }) => {
    const user = requireUser(locals);
    const value = String((await request.formData()).get('openrouter') ?? '').trim();
    if (!value) return fail(400, { message: 'Paste an OpenRouter key first.' });
    try {
      await setProviderCredential(user.id, 'openrouter', value);
    } catch (error) {
      return fail(400, { message: error instanceof Error ? error.message : 'The key could not be stored.' });
    }
    return { saved: 'openrouter' };
  },
  removeKey: async ({ locals }) => {
    const user = requireUser(locals);
    await deleteProviderCredential(user.id, 'openrouter');
    return { saved: 'openrouter-removed' };
  }
};

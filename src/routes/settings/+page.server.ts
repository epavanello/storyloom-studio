import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { deleteProviderCredential, getUserSettings, listCredentialHints, saveUserSettings, setProviderCredential } from '$lib/server/accounts';
import { getConfig } from '$lib/server/config';
import { queueSnapshotsForUser } from '$lib/server/jobs';
import { localQueueFor } from '$lib/server/queue/names';
import { requireUser } from '$lib/server/session';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const config = getConfig();
  const [settings, credentials, queues] = await Promise.all([
    getUserSettings(user.id),
    listCredentialHints(user.id),
    queueSnapshotsForUser(user.id).catch(() => [])
  ]);
  return {
    settings,
    credentials,
    queues,
    // Shown so a user configuring their own machine can copy the exact value.
    localQueue: localQueueFor(user.id),
    deployment: {
      mode: config.mode,
      storage: config.storage.driver,
      workerMode: config.worker.mode,
      hasPlatformKey: Boolean(config.openRouterApiKey)
    }
  };
};

export const actions: Actions = {
  execution: async ({ locals, request }) => {
    const user = requireUser(locals);
    const value = String((await request.formData()).get('execution') ?? '');
    if (value !== 'cloud' && value !== 'local') return fail(400, { message: 'Unknown execution target.' });
    await saveUserSettings(user.id, { execution: value });
    return { saved: 'execution' };
  },
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

<script lang="ts">
  import { enhance } from '$app/forms';
  import { authClient } from '$lib/auth-client';

  let { data, form } = $props();
  const openrouter = $derived(data.credentials.find((credential) => credential.provider === 'openrouter'));
  const workerCommand = $derived(data.deployment.mode === 'mock' ? 'pnpm worker' : `pnpm worker:${data.deployment.mode}`);
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmation = $state('');
  let passwordBusy = $state(false);
  let passwordMessage = $state('');
  let passwordSuccess = $state(false);

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    passwordSuccess = false;
    if (newPassword.length < 10) {
      passwordMessage = 'Use at least 10 characters for the new password.';
      return;
    }
    if (newPassword !== confirmation) {
      passwordMessage = 'The new passwords do not match.';
      return;
    }
    passwordBusy = true;
    passwordMessage = '';
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    passwordBusy = false;
    if (result.error) {
      passwordMessage = result.error.message ?? 'The password could not be changed.';
      return;
    }
    currentPassword = '';
    newPassword = '';
    confirmation = '';
    passwordSuccess = true;
  }
</script>

<svelte:head><title>Settings · Storyloom</title></svelte:head>

<main class="settings-shell">
  <header class="brand-bar">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <nav class="account-nav"><a href="/">Library</a><a href="/jobs">Jobs</a></nav>
  </header>

  <section class="section-title"><div><p class="eyebrow">Account</p><h1>Settings</h1></div></section>

  {#if form?.message}<p class="form-error">{form.message}</p>{/if}

  <section class="settings-card account-security-card">
    <h2>Account security</h2>
    <div class="account-email-row">
      <div><span>Email</span><strong>{data.account.email}</strong></div>
      <span class:verified={data.account.emailVerified} class="verification-pill">{data.account.emailVerified ? 'Verified' : 'Not verified'}</span>
    </div>
    {#if !data.account.emailVerified && data.deployment.mailEnabled}
      <p class="settings-note">Verify this address before relying on account recovery. <a href={`/auth/check-email?email=${encodeURIComponent(data.account.email)}`}>Send another verification email</a>.</p>
    {/if}
    {#if data.account.hasPassword}
      <form class="password-form" onsubmit={changePassword}>
        <label>Current password<input type="password" bind:value={currentPassword} autocomplete="current-password" required /></label>
        <label>New password<input type="password" bind:value={newPassword} autocomplete="new-password" minlength="10" required /></label>
        <label>Confirm new password<input type="password" bind:value={confirmation} autocomplete="new-password" minlength="10" required /></label>
        <small>Changing your password signs out every other session.</small>
        {#if passwordMessage}<p class="form-error">{passwordMessage}</p>{/if}
        {#if passwordSuccess}<p class="form-success">Password changed. Other sessions have been signed out.</p>{/if}
        <button class="secondary-button" disabled={passwordBusy}>{passwordBusy ? 'Changing…' : 'Change password'}</button>
      </form>
      {#if data.deployment.mailEnabled}<p class="settings-note recovery-note">Can’t remember the current password? <a href="/auth/forgot-password">Use account recovery</a>.</p>{/if}
    {:else}
      <p class="settings-note">This account signs in through a connected identity provider and does not currently have a password.{data.deployment.mailEnabled ? ' Account recovery can securely create one after email confirmation.' : ''}</p>
      {#if data.deployment.mailEnabled}<a class="secondary-button settings-recovery-link" href="/auth/forgot-password">Create a password by email</a>{/if}
    {/if}
  </section>

  <section class="settings-card">
    <h2>{data.deployment.keyMode === 'account' ? 'Your OpenRouter key' : 'OpenRouter access'}</h2>
    {#if data.deployment.keyMode === 'account'}
      <p>Your key pays OpenRouter directly for your generations. Storyloom seals it with AES-256-GCM at rest, decrypts it only inside your job, and never returns it to the browser, logs it, or writes it into an artifact.</p>
      <p class="settings-note">Create a key in <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">OpenRouter settings ↗</a>. Usage and billing remain in your OpenRouter account.</p>
    {:else if !data.deployment.usesCloud}
      <p>This deployment runs inference on its own machine in <strong>{data.deployment.mode}</strong> mode, so no cloud key is needed. If the operator switches to cloud later, they can configure one shared environment key.</p>
    {:else}
      <p>This trusted self-host uses one operator-managed OpenRouter key for every account. Personal keys are not read in shared mode.</p>
    {/if}

    {#if data.deployment.keyMode === 'account' && openrouter}
      <div class="credential-row">
        <span>Saved key <code>{openrouter.hint}</code> · updated {new Date(openrouter.updatedAt).toLocaleDateString()}</span>
        <form method="POST" action="?/removeKey" use:enhance><button class="text-button">Remove</button></form>
      </div>
    {:else if data.deployment.keyMode === 'account'}
      <p class="settings-note">No key saved. Cloud generation stays disabled for your account until you add one.</p>
    {:else if data.deployment.usesCloud}
      <p class="settings-note">Shared key: {data.deployment.hasPlatformKey ? 'configured by the operator' : 'missing — cloud generation will fail until the operator configures OPENROUTER_API_KEY'}.</p>
    {/if}

    {#if data.deployment.keyMode === 'account'}
      <form method="POST" action="?/saveKey" use:enhance>
        <label>OpenRouter API key<input type="password" name="openrouter" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder="sk-or-v1-…" required /></label>
        <button class="secondary-button">{openrouter ? 'Replace key' : 'Save key'}</button>
      </form>
    {:else if openrouter}
      <div class="credential-row">
        <span>An unused personal key <code>{openrouter.hint}</code> is still stored.</span>
        <form method="POST" action="?/removeKey" use:enhance><button class="text-button">Remove it</button></form>
      </div>
    {/if}
  </section>

  <section class="settings-card">
    <h2>Deployment</h2>
    <p>Where generation runs is a property of this deployment, not of your account. It executes everything in <strong>{data.deployment.mode}</strong> mode.</p>
    <dl class="deployment-list">
      <div><dt>Runtime mode</dt><dd>{data.deployment.mode}</dd></div>
      <div><dt>Artifact storage</dt><dd>{data.deployment.storage === 's3' ? 'S3-compatible object storage' : 'local filesystem'}</dd></div>
      <div><dt>Queue consumer</dt><dd>{data.deployment.workerMode === 'inline' ? 'inside the web process' : data.deployment.workerMode === 'external' ? 'separate worker process' : 'disabled here'}</dd></div>
      <div>
        <dt>Queue</dt>
        <dd>{data.deployment.queueDriver === 'redis' ? 'Redis' : 'in-process (no Redis)'}</dd>
      </div>
      <div>
        <dt>Worker</dt>
        <dd class="worker-status" class:online={data.queue?.hasWorker}>{data.queue?.hasWorker ? 'connected' : 'not connected'}</dd>
      </div>
    </dl>
    {#if data.deployment.queueDriver === 'memory'}
      <p class="settings-note">The queue lives in this process, so no broker is needed. Queued and active work is restored from the database after a restart; chapter jobs reuse every compatible speech passage checkpointed before the interruption. Set <code>REDIS_URL</code> to move the queue to Redis, which is required as soon as the worker runs anywhere else.</p>
    {/if}
    {#if data.queue && !data.queue.hasWorker}
      <p class="queue-warning">
        Nothing is draining the queue, so new work will wait.
        {data.deployment.workerMode === 'inline' ? 'The web process should be running a worker — check its logs.' : `Start \`${workerCommand}\` on the machine that runs inference.`}
      </p>
    {/if}
  </section>
</main>

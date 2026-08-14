<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();
  const openrouter = $derived(data.credentials.find((credential) => credential.provider === 'openrouter'));
  const workerCommand = $derived(data.deployment.mode === 'mock' ? 'pnpm worker' : `pnpm worker:${data.deployment.mode}`);
</script>

<svelte:head><title>Settings · Storyloom</title></svelte:head>

<main class="settings-shell">
  <header class="brand-bar">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <nav class="account-nav"><a href="/">Library</a><a href="/jobs">Jobs</a></nav>
  </header>

  <section class="section-title"><div><p class="eyebrow">Account</p><h1>Settings</h1></div></section>

  {#if form?.message}<p class="form-error">{form.message}</p>{/if}

  <section class="settings-card">
    <h2>Your OpenRouter key</h2>
    {#if data.deployment.usesCloud}
      <p>Stored encrypted and only decrypted while one of your own jobs runs. It is never sent to the browser and never written into an artifact.</p>
    {:else}
      <p>This deployment runs inference on its own machine in <strong>{data.deployment.mode}</strong> mode, so no cloud key is needed right now. A key saved here is used if the deployment is later switched to cloud.</p>
    {/if}

    {#if openrouter}
      <div class="credential-row">
        <span>Saved key <code>{openrouter.hint}</code> · updated {new Date(openrouter.updatedAt).toLocaleDateString()}</span>
        <form method="POST" action="?/removeKey" use:enhance><button class="text-button">Remove</button></form>
      </div>
    {:else if data.deployment.hasPlatformKey}
      <p class="settings-note">No personal key saved. This deployment has an operator key configured, which will be used instead.</p>
    {:else if data.deployment.usesCloud}
      <p class="settings-note">No key saved. Cloud generation will fail until you add one.</p>
    {/if}

    <form method="POST" action="?/saveKey" use:enhance>
      <label>OpenRouter API key<input type="password" name="openrouter" autocomplete="off" placeholder="sk-or-…" /></label>
      <button class="secondary-button">Save key</button>
    </form>
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

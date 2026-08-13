<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();
  const openrouter = $derived(data.credentials.find((credential) => credential.provider === 'openrouter'));
  const localQueue = $derived(data.queues.find((queue) => queue.target === 'local'));
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
    <h2>Where your jobs run</h2>
    <p>Cloud jobs are picked up by the shared worker using your own provider key. Local jobs are parked on a private queue that only a worker you start can drain, so the book text never leaves your machine.</p>
    <form method="POST" action="?/execution" use:enhance>
      <div class="radio-row">
        <label class:selected={data.settings.execution === 'cloud'}>
          <input type="radio" name="execution" value="cloud" checked={data.settings.execution === 'cloud'} />
          <div><strong>Cloud</strong><small>Runs on this deployment with your OpenRouter key.</small></div>
        </label>
        <label class:selected={data.settings.execution === 'local'}>
          <input type="radio" name="execution" value="local" checked={data.settings.execution === 'local'} />
          <div><strong>My own machine</strong><small>Runs where you start the worker. Nothing runs until you do.</small></div>
        </label>
      </div>
      <button class="secondary-button">Save</button>
    </form>

    {#if data.settings.execution === 'local'}
      <div class="worker-hint">
        <p>Start the worker on the machine that holds your models:</p>
        <pre><code>STORYLOOM_MODE=local \
STORYLOOM_WORKER_QUEUES={data.localQueue.replace('storyloom-local-', 'local:')} \
DATABASE_URL=… REDIS_URL=… \
pnpm worker</code></pre>
        <p class="worker-status" class:online={localQueue?.hasWorker}>
          {localQueue?.hasWorker ? 'A worker is currently connected to your queue.' : 'No worker is connected to your queue right now.'}
        </p>
      </div>
    {/if}
  </section>

  <section class="settings-card">
    <h2>Your OpenRouter key</h2>
    <p>Stored encrypted and only decrypted when one of your own jobs runs. It is never sent to the browser and never written into an artifact.</p>
    {#if openrouter}
      <div class="credential-row">
        <span>Saved key <code>{openrouter.hint}</code> · updated {new Date(openrouter.updatedAt).toLocaleDateString()}</span>
        <form method="POST" action="?/removeKey" use:enhance><button class="text-button">Remove</button></form>
      </div>
    {:else if data.deployment.hasPlatformKey}
      <p class="settings-note">No personal key saved. This deployment has an operator key configured, which will be used instead.</p>
    {:else}
      <p class="settings-note">No key saved. Cloud generation will fail until you add one.</p>
    {/if}
    <form method="POST" action="?/saveKey" use:enhance>
      <label>OpenRouter API key<input type="password" name="openrouter" autocomplete="off" placeholder="sk-or-…" /></label>
      <button class="secondary-button">Save key</button>
    </form>
  </section>

  <section class="settings-card">
    <h2>Deployment</h2>
    <dl class="deployment-list">
      <div><dt>Runtime mode</dt><dd>{data.deployment.mode}</dd></div>
      <div><dt>Artifact storage</dt><dd>{data.deployment.storage === 's3' ? 'S3-compatible object storage' : 'local filesystem'}</dd></div>
      <div><dt>Web process worker</dt><dd>{data.deployment.workerMode}</dd></div>
    </dl>
  </section>
</main>

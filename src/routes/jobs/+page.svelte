<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { GenerationJob, QueueSnapshot } from '$lib/core/schemas';

  let { data } = $props();
  let jobs = $state<GenerationJob[]>([]);
  let queue = $state<QueueSnapshot | null>(null);
  let message = $state('');

  $effect(() => {
    jobs = data.jobs;
    queue = data.queue;
  });

  const unfinished = $derived(jobs.filter((job) => job.status === 'queued' || job.status === 'active'));
  const finished = $derived(jobs.filter((job) => job.status !== 'queued' && job.status !== 'active'));
  const workerCommand = $derived(data.deployment.mode === 'mock' ? 'pnpm worker' : `pnpm worker:${data.deployment.mode}`);

  onMount(() => {
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  });

  async function refresh() {
    try {
      const response = await fetch('/api/jobs?limit=60', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as { jobs: GenerationJob[]; queue: QueueSnapshot };
      jobs = payload.jobs;
      queue = payload.queue;
    } catch {
      // Keep the last known state rather than blanking the dashboard on a hiccup.
    }
  }

  async function cancel(job: GenerationJob) {
    message = '';
    const response = await fetch(`/api/jobs/${job.id}`, { method: 'POST' });
    if (!response.ok) message = (await response.json()).error ?? 'Could not cancel the job.';
    await refresh();
  }

  async function remove(job: GenerationJob) {
    message = '';
    const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    if (!response.ok) message = (await response.json()).error ?? 'Could not remove the job.';
    await refresh();
    await invalidateAll();
  }

  function title(job: GenerationJob) {
    const book = data.titles[job.bookId] ?? job.bookId;
    return job.kind === 'story' ? `${book} · source story` : job.kind === 'registry' ? `${book} · character registry` : `${book} · ${job.chapterId}`;
  }

  function percent(job: GenerationJob) {
    const done = job.steps.reduce((sum, step) => {
      if (step.status === 'completed') return sum + 1;
      return sum + Math.min(1, step.completed / Math.max(1, step.total));
    }, 0);
    return Math.round(done / Math.max(1, job.steps.length) * 100);
  }

  function when(value: string | null) {
    return value ? new Date(value).toLocaleString() : '—';
  }
</script>

<svelte:head><title>Job queue · Storyloom</title></svelte:head>

<main class="jobs-shell">
  <header class="brand-bar">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <nav class="account-nav"><a href="/">Library</a><a href="/settings">Settings</a></nav>
  </header>

  <section class="section-title">
    <div><p class="eyebrow">Everything in flight</p><h1>Job queue</h1></div>
    <span>{unfinished.length} unfinished</span>
  </section>

  {#if queue}
    <div class="queue-grid">
      <article class="queue-card" class:stalled={!queue.hasWorker && queue.waiting > 0}>
        <div class="queue-head">
          <strong>Generation queue · {data.deployment.mode}</strong>
          <span class:online={queue.hasWorker}>{queue.hasWorker ? 'worker online' : 'no worker'}</span>
        </div>
        <code>{queue.name}</code>
        <dl class="queue-counts">
          <div><dt>Waiting</dt><dd>{queue.waiting}</dd></div>
          <div><dt>Active</dt><dd>{queue.active}</dd></div>
          <div><dt>Delayed</dt><dd>{queue.delayed}</dd></div>
          <div><dt>Completed</dt><dd>{queue.completed}</dd></div>
          <div><dt>Failed</dt><dd>{queue.failed}</dd></div>
        </dl>
        {#if !queue.hasWorker}
          <p class="queue-warning">
            No worker is draining this queue{queue.waiting ? `, and ${queue.waiting} job${queue.waiting === 1 ? ' is' : 's are'} waiting` : ''}.
            {data.deployment.workerMode === 'inline' ? 'The web process should be running one — check its logs.' : `Start \`${workerCommand}\` on the machine that runs inference.`}
          </p>
        {/if}
      </article>
    </div>
  {/if}

  {#if message}<p class="form-error">{message}</p>{/if}

  <section class="jobs-list">
    <h2>In progress</h2>
    {#if unfinished.length === 0}
      <p class="jobs-empty">Nothing queued or running.</p>
    {/if}
    {#each unfinished as job}
      <article class="job-card">
        <div class="job-summary">
          <div>
            <strong>{title(job)}</strong>
            <span>
              {job.status === 'queued' ? `Queued${job.queuePosition ? ` · position ${job.queuePosition}` : ''}` : 'Running'}
              · {job.mode}
              · started {when(job.startedAt)}
            </span>
          </div>
          <b>{percent(job)}%</b>
        </div>
        <div class="job-progress"><i style={`width: ${percent(job)}%`}></i></div>
        <ol class="job-steps">
          {#each job.steps as step}
            <li class:done={step.status === 'completed'} class:current={step.status === 'running'} class:failed={step.status === 'failed'}>
              <i>{step.status === 'completed' ? '✓' : step.status === 'running' ? '•' : step.status === 'failed' ? '!' : '○'}</i>
              <div><span>{step.label}</span>{#if step.detail}<small>{step.detail}</small>{/if}</div>
              {#if step.total > 1}<b>{step.completed}/{step.total}</b>{/if}
            </li>
          {/each}
        </ol>
        <div class="job-actions"><button class="text-button" onclick={() => cancel(job)}>Cancel</button></div>
      </article>
    {/each}
  </section>

  <section class="jobs-list">
    <h2>History</h2>
    {#if finished.length === 0}
      <p class="jobs-empty">No finished jobs yet.</p>
    {/if}
    <table class="jobs-table">
      <thead><tr><th>Job</th><th>Status</th><th>Runtime</th><th>Finished</th><th></th></tr></thead>
      <tbody>
        {#each finished as job}
          <tr>
            <td>{title(job)}</td>
            <td><span class={`status-pill ${job.status}`}>{job.status}</span>{#if job.error}<small class="job-error">{job.error}</small>{/if}</td>
            <td>{job.mode}</td>
            <td>{when(job.completedAt)}</td>
            <td><button class="text-button" onclick={() => remove(job)}>Remove</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</main>

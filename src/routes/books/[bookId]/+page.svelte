<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { GenerationJob, RenderedChapter } from '$lib/core/schemas';

  let { data } = $props();
  let rendered = $state<RenderedChapter | null>(null);
  let jobs = $state<GenerationJob[]>([]);
  let requestError = $state('');
  let activeIndex = $state(0);
  let activeTimeMs = $state(0);
  let playing = $state(false);
  let audio = $state<HTMLAudioElement>();

  const chapter = $derived(data.book.chapters.find((item) => item.id === data.chapterId));
  const activeUtterance = $derived(rendered?.utterances[activeIndex]);
  const globalTime = $derived((activeUtterance?.startMs ?? 0) + activeTimeMs);
  const activeVisual = $derived(rendered?.visuals.filter((visual) => visual.startMs <= globalTime).at(-1) ?? rendered?.visuals[0]);
  const progress = $derived(rendered ? Math.min(100, globalTime / rendered.totalDurationMs * 100) : 0);
  const activeJobs = $derived(jobs.filter((job) => job.status === 'queued' || job.status === 'running'));
  const chapterJobActive = $derived(activeJobs.some((job) => job.kind === 'chapter' && job.chapterId === data.chapterId));
  const registryJobActive = $derived(activeJobs.some((job) => job.kind === 'registry'));
  const latestRelevantJob = $derived(jobs.find((job) => (job.kind === 'chapter' && job.chapterId === data.chapterId) || (job.kind === 'registry' && data.book.registryStatus !== 'ready')));
  const failedJob = $derived(latestRelevantJob?.status === 'failed' ? latestRelevantJob : undefined);

  $effect(() => {
    if (!rendered && data.rendered) rendered = data.rendered;
  });

  $effect(() => {
    jobs = data.jobs;
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (activeJobs.length) void refreshJobs();
    }, 1200);
    return () => clearInterval(timer);
  });

  async function refreshJobs() {
    const hadActiveJobs = activeJobs.length > 0;
    try {
      const response = await fetch(`/api/books/${data.book.id}/jobs`, { cache: 'no-store' });
      if (!response.ok) return;
      jobs = await response.json();
      if (hadActiveJobs && !jobs.some((job) => job.status === 'queued' || job.status === 'running')) await invalidateAll();
    } catch {
      // A transient polling failure should not hide the last persisted progress.
    }
  }

  async function request(path: string) {
    requestError = '';
    const response = await fetch(path, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) { requestError = payload.error ?? 'Generation failed'; return null; }
    const job = payload as GenerationJob;
    jobs = [job, ...jobs.filter((candidate) => candidate.id !== job.id)];
    return payload;
  }

  async function prepareRegistry() {
    await request(`/api/books/${data.book.id}/registry`);
  }

  async function prepareChapter() {
    await request(`/api/books/${data.book.id}/chapters/${data.chapterId}/prepare`);
  }

  function jobProgress(job: GenerationJob) {
    const completedStages = job.steps.reduce((sum, item) => {
      if (item.status === 'completed') return sum + 1;
      return sum + Math.min(1, item.completed / Math.max(1, item.total));
    }, 0);
    return Math.round(completedStages / Math.max(1, job.steps.length) * 100);
  }

  async function togglePlayback() {
    if (!audio || !activeUtterance) return;
    if (playing) { audio.pause(); playing = false; }
    else { await audio.play(); playing = true; }
  }

  async function nextUtterance() {
    if (!rendered) return;
    if (activeIndex < rendered.utterances.length - 1) {
      activeIndex += 1; activeTimeMs = 0;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (playing) await audio?.play();
    } else { playing = false; }
  }

  function seek(event: Event) {
    if (!rendered) return;
    const target = Number((event.target as HTMLInputElement).value) / 100 * rendered.totalDurationMs;
    const index = Math.max(0, rendered.utterances.findLastIndex((item) => item.startMs <= target));
    activeIndex = index;
    activeTimeMs = Math.max(0, target - rendered.utterances[index].startMs);
    setTimeout(() => { if (audio) audio.currentTime = activeTimeMs / 1000; }, 0);
  }

  function formatTime(milliseconds: number) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
</script>

<svelte:head><title>{data.book.title} · Storyloom</title></svelte:head>

<div class="studio-shell">
  <aside class="studio-sidebar">
    <a class="brand compact" href="/"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <a class="back-link" href="/">← Library</a>
    <div class="book-identity">
      <div class="side-cover"><span>{data.book.title.slice(0, 1)}</span></div>
      <div><strong>{data.book.title}</strong><small>{data.book.sourceName}</small></div>
    </div>
    <nav class="chapter-list" aria-label="Chapters">
      <p>Chapters</p>
      {#each data.book.chapters as item}
        <a class:active={item.id === data.chapterId} href={`/books/${data.book.id}?chapter=${item.id}`}>
          <span>{String(item.order + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{Math.max(1, Math.round(item.characterCount / 900))} min read</small></div>
        </a>
      {/each}
    </nav>
    <div class="runtime-card"><span><i></i> Runtime · {data.runtime.mode}</span><strong>{data.runtime.mode === 'mock' ? 'Demo provider' : data.runtime.text}</strong><small>{data.runtime.mode === 'mock' ? 'Configure local or cloud models in .env' : `${data.runtime.speech} · ${data.runtime.image} · ${data.runtime.alignment}`}</small></div>
  </aside>

  <main class="studio-main">
    <header class="studio-header">
      <div><p class="eyebrow">Chapter {chapter ? chapter.order + 1 : ''}</p><h1>{chapter?.title}</h1></div>
      <div class="header-actions">
        <span class:ready={data.book.registryStatus === 'ready'} class="registry-badge">{data.book.registryStatus === 'ready' ? '✓ Character registry ready' : 'Character registry pending'}</span>
        {#if data.book.registryStatus !== 'ready'}<button class="secondary-button" onclick={prepareRegistry} disabled={registryJobActive}>Build registry</button>{/if}
      </div>
    </header>

    {#if activeJobs.length}
      <section class="jobs-panel" aria-live="polite">
        <div class="jobs-heading"><div class="spinner"></div><div><strong>Storyloom is still working</strong><span>Progress survives a browser reload. {data.runtime.mode === 'local' ? 'Local jobs share one memory-safe queue.' : 'Jobs can run concurrently in this mode.'}</span></div></div>
        {#each activeJobs as job}
          <article class="job-card">
            <div class="job-summary">
              <div><strong>{job.kind === 'registry' ? 'Character registry' : data.book.chapters.find((item) => item.id === job.chapterId)?.title ?? 'Chapter performance'}</strong><span>{job.status === 'queued' ? `Queued${job.queuePosition ? ` · position ${job.queuePosition}` : ''}` : 'Generating now'}</span></div>
              <b>{jobProgress(job)}%</b>
            </div>
            <div class="job-progress"><i style={`width: ${jobProgress(job)}%`}></i></div>
            <ol class="job-steps">
              {#each job.steps as item}
                <li class:done={item.status === 'completed'} class:current={item.status === 'running'} class:failed={item.status === 'failed'}>
                  <i>{item.status === 'completed' ? '✓' : item.status === 'running' ? '•' : item.status === 'failed' ? '!' : '○'}</i>
                  <div><span>{item.label}</span>{#if item.detail}<small>{item.detail}</small>{/if}</div>
                  {#if item.total > 1}<b>{item.completed}/{item.total}</b>{/if}
                </li>
              {/each}
            </ol>
          </article>
        {/each}
      </section>
    {:else if requestError || failedJob}
      <section class="error-panel"><strong>Something stopped the pipeline</strong><span>{requestError || failedJob?.error}</span></section>
    {/if}

    {#if rendered}
      <section class="experience-grid">
        <div class="visual-stage">
          {#if activeVisual}<img src={activeVisual.image.path} alt={activeVisual.cue.prompt} />{/if}
          <div class="visual-overlay"><span>SCENE {Math.max(1, (rendered.visuals.indexOf(activeVisual!) + 1)).toString().padStart(2, '0')}</span><small>{activeVisual?.cue.shot}</small></div>
          <div class="image-dots">{#each rendered.visuals as visual}<i class:active={visual.cue.id === activeVisual?.cue.id}></i>{/each}</div>
        </div>

        <div class="reading-panel">
          <div class="reading-heading"><span>Performance script</span><small>{rendered.plan.utterances.length} voiced passages</small></div>
          <div class="script-scroll">
            {#each rendered.utterances as item, index}
              <button class:active={index === activeIndex} class="utterance" onclick={() => { activeIndex = index; activeTimeMs = 0; }}>
                <span class="speaker">{item.utterance.speakerCharacterId ? data.book.characters.find((character) => character.id === item.utterance.speakerCharacterId)?.canonicalName ?? item.utterance.speakerCharacterId : 'Narrator'}</span>
                <span class="spoken-text">{item.utterance.text}</span>
                <span class="direction">{item.utterance.direction.emotion} · {item.utterance.direction.pace}<i class:exact={item.alignment === 'exact'}>{item.alignment}</i></span>
              </button>
            {/each}
          </div>
        </div>
      </section>

      {#if activeUtterance}
        <audio bind:this={audio} src={activeUtterance.audio.path} ontimeupdate={(event) => activeTimeMs = event.currentTarget.currentTime * 1000} onended={nextUtterance}></audio>
      {/if}
      <section class="transport">
        <button class="round-button" onclick={() => { activeIndex = Math.max(0, activeIndex - 1); activeTimeMs = 0; }} aria-label="Previous passage">‹</button>
        <button class="play-button" onclick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button class="round-button" onclick={nextUtterance} aria-label="Next passage">›</button>
        <span class="timecode">{formatTime(globalTime)}</span>
        <input class="timeline" type="range" min="0" max="100" step="0.05" value={progress} oninput={seek} aria-label="Chapter progress" />
        <span class="timecode">{formatTime(rendered.totalDurationMs)}</span>
        <span class="voice-chip">◉ {activeUtterance?.utterance.speakerCharacterId ? 'Character voice' : 'Narrator'}</span>
      </section>
    {:else}
      <section class="empty-experience">
        <div class="empty-art"><span>✦</span><i></i><i></i><i></i></div>
        <p class="eyebrow">On-demand chapter</p>
        <h2>Ready for its first performance</h2>
        <p>The director will read the complete chapter, assign voices and emotion, choose visual beats, then generate synchronized assets.</p>
        <button class="primary-button wide" onclick={prepareChapter} disabled={chapterJobActive}>{chapterJobActive ? 'Chapter queued or generating…' : 'Prepare this chapter'} <span>→</span></button>
        <div class="pipeline-preview"><span>Understand</span><b>→</b><span>Direct voices</span><b>→</b><span>Stage scenes</span><b>→</b><span>Synchronize</span></div>
      </section>
    {/if}

    <section class="character-section">
      <div class="section-title"><div><p class="eyebrow">Source of truth</p><h2>Character registry</h2></div><span>{data.book.characters.length} locked identities</span></div>
      {#if data.book.characters.length}
        <div class="character-row">
          {#each data.book.characters as character}
            <article class="character-card">
              {#if character.referenceImages[0]}<img src={character.referenceImages[0].path} alt={`${character.canonicalName} reference`} />{:else}<div class="character-placeholder">{character.canonicalName.slice(0, 1)}</div>{/if}
              <div><strong>{character.canonicalName}</strong><span>{character.narrativeRole}</span><p>{character.physicalDescription}</p></div>
            </article>
          {/each}
        </div>
      {:else}
        <div class="registry-empty"><span>Characters will appear here after the registry pass.</span><button class="text-button" onclick={prepareRegistry} disabled={registryJobActive}>Build character registry</button></div>
      {/if}
    </section>
  </main>
</div>

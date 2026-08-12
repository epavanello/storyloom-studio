<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import type { GenerationJob, RenderedChapter } from '$lib/core/schemas';

  let { data } = $props();
  let rendered = $state<RenderedChapter | null>(null);
  let jobs = $state<GenerationJob[]>([]);
  let requestError = $state('');
  let activeIndex = $state(0);
  let activeTimeMs = $state(0);
  let playing = $state(false);
  let audio = $state<HTMLAudioElement>();
  let scriptScroll = $state<HTMLDivElement>();
  let loadedChapterId = $state<string>();
  let playbackChangeId = 0;

  const chapter = $derived(data.book.chapters.find((item) => item.id === data.chapterId));
  const activeUtterance = $derived(rendered?.utterances[activeIndex]);
  const globalTime = $derived((activeUtterance?.startMs ?? 0) + activeTimeMs);
  const activeVisual = $derived(rendered?.visuals.filter((visual) => visual.startMs <= globalTime).at(-1) ?? rendered?.visuals[0]);
  const progress = $derived(rendered ? Math.min(100, globalTime / rendered.totalDurationMs * 100) : 0);
  const activeJobs = $derived(jobs.filter((job) => job.status === 'queued' || job.status === 'running'));
  const chapterJobActive = $derived(activeJobs.some((job) => (job.kind === 'chapter' || job.kind === 'chapter-audio') && job.chapterId === data.chapterId));
  const audioJobActive = $derived(activeJobs.some((job) => job.kind === 'chapter-audio' && job.chapterId === data.chapterId));
  const registryJobActive = $derived(activeJobs.some((job) => job.kind === 'registry'));
  const latestRelevantJob = $derived(jobs.find((job) => ((job.kind === 'chapter' || job.kind === 'chapter-audio') && job.chapterId === data.chapterId) || job.kind === 'registry' || job.kind === 'character-reference'));
  const failedJob = $derived(latestRelevantJob?.status === 'failed' ? latestRelevantJob : undefined);
  const visualReferencesOutdated = $derived(
    data.book.characters.some((character) => !character.referenceImages.some((reference) => reference.styleId === data.book.visualStyle.id))
    || data.book.worldElements.some((element) => !element.referenceImages.some((reference) => reference.styleId === data.book.visualStyle.id))
  );

  $effect(() => {
    const chapterId = data.chapterId;
    const nextRendered = data.rendered;
    const renderChanged = nextRendered?.createdAt !== rendered?.createdAt;
    if (loadedChapterId !== chapterId || renderChanged) {
      playbackChangeId += 1;
      audio?.pause();
      loadedChapterId = chapterId;
      rendered = nextRendered;
      activeIndex = 0;
      activeTimeMs = 0;
      playing = false;
    }
  });

  $effect(() => {
    jobs = data.jobs;
  });

  $effect(() => {
    const index = activeIndex;
    rendered?.chapterId;
    requestAnimationFrame(() => {
      const active = scriptScroll?.querySelector<HTMLElement>(`[data-utterance-index="${index}"]`);
      if (!active || !scriptScroll) return;
      const viewport = scriptScroll.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const safeTop = viewport.top + 16;
      const safeBottom = viewport.bottom - 56;
      if (item.bottom > safeBottom) scriptScroll.scrollBy({ top: item.bottom - safeBottom, behavior: playing ? 'smooth' : 'auto' });
      else if (item.top < safeTop) scriptScroll.scrollBy({ top: item.top - safeTop, behavior: playing ? 'smooth' : 'auto' });
    });
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

  async function regenerateChapter() {
    if (!confirm('Regenerate the complete chapter? This creates new audio and scene artifacts and may take several minutes. Existing artifact files are preserved.')) return;
    audio?.pause();
    playing = false;
    await request(`/api/books/${data.book.id}/chapters/${data.chapterId}/prepare?force=true`);
  }

  async function regenerateAudio() {
    if (!confirm('Regenerate every voice passage and its word alignment? The current plan and scene images will be preserved. Existing audio files remain recoverable.')) return;
    audio?.pause();
    playing = false;
    await request(`/api/books/${data.book.id}/chapters/${data.chapterId}/audio/regenerate`);
  }

  async function regenerateCharacter(characterId: string) {
    await request(`/api/books/${data.book.id}/characters/${encodeURIComponent(characterId)}/reference`);
  }

  async function deleteBook() {
    if (activeJobs.length) { requestError = 'Wait for the active generation job before deleting the book.'; return; }
    if (!confirm(`Remove “${data.book.title}” and all its generated artifacts from the library? It will be moved to Storyloom's recoverable data trash.`)) return;
    const response = await fetch(`/api/books/${data.book.id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) { requestError = payload.error ?? 'Book deletion failed'; return; }
    await goto('/');
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
    playbackChangeId += 1;
    if (playing) {
      audio.pause();
      playing = false;
      return;
    }
    try {
      await audio.play();
      playing = true;
    } catch {
      playing = false;
    }
  }

  async function selectUtterance(index: number, timeMs = 0, resume = playing) {
    if (!rendered || !rendered.utterances[index]) return;
    const changeId = ++playbackChangeId;
    audio?.pause();
    playing = false;
    activeIndex = index;
    activeTimeMs = Math.max(0, timeMs);
    await tick();
    if (changeId !== playbackChangeId || !audio) return;
    audio.currentTime = activeTimeMs / 1000;
    if (!resume) return;
    try {
      await audio.play();
      if (changeId === playbackChangeId) playing = true;
    } catch {
      if (changeId === playbackChangeId) playing = false;
    }
  }

  async function nextUtterance(resume = playing) {
    if (!rendered) return;
    if (activeIndex < rendered.utterances.length - 1) {
      await selectUtterance(activeIndex + 1, 0, resume);
    } else { playing = false; }
  }

  function seek(event: Event) {
    if (!rendered) return;
    const target = Number((event.target as HTMLInputElement).value) / 100 * rendered.totalDurationMs;
    const index = Math.max(0, rendered.utterances.findLastIndex((item) => item.startMs <= target));
    const timeMs = Math.max(0, target - rendered.utterances[index].startMs);
    if (index === activeIndex && audio) {
      activeTimeMs = timeMs;
      audio.currentTime = timeMs / 1000;
      return;
    }
    void selectUtterance(index, timeMs, playing);
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
    <button class="danger-button" onclick={deleteBook} disabled={activeJobs.length > 0}>Delete book</button>
  </aside>

  <main class="studio-main">
    <header class="studio-header">
      <div><p class="eyebrow">Chapter {chapter ? chapter.order + 1 : ''}</p><h1>{chapter?.title}</h1></div>
      <div class="header-actions">
        <span class:ready={data.book.registryStatus === 'ready' && !visualReferencesOutdated} class="registry-badge">{data.book.registryStatus === 'ready' ? visualReferencesOutdated ? 'Visual references need refresh' : '✓ Continuity registries ready' : 'Continuity registries pending'}</span>
        {#if data.book.registryStatus !== 'ready'}
          <button class="secondary-button" onclick={prepareRegistry} disabled={registryJobActive}>Build registry</button>
        {:else if visualReferencesOutdated}
          <button class="secondary-button" onclick={prepareRegistry} disabled={registryJobActive}>Refresh illustrated references</button>
        {/if}
        {#if rendered}<button class="secondary-button" onclick={regenerateAudio} disabled={chapterJobActive}>{audioJobActive ? 'Regenerating audio…' : 'Regenerate all audio'}</button><button class="secondary-button" onclick={regenerateChapter} disabled={chapterJobActive}>Regenerate chapter</button>{/if}
      </div>
    </header>

    {#if activeJobs.length}
      <section class="jobs-panel" aria-live="polite">
        <div class="jobs-heading"><div class="spinner"></div><div><strong>Storyloom is still working</strong><span>Progress survives a browser reload. {data.runtime.serialized ? 'Jobs share one memory-safe local queue.' : 'Jobs can run concurrently in this mode.'}</span></div></div>
        {#each activeJobs as job}
          <article class="job-card">
            <div class="job-summary">
              <div><strong>{job.kind === 'registry' ? 'Continuity registries' : job.kind === 'character-reference' ? `Character reference · ${data.book.characters.find((character) => character.id === job.characterId)?.canonicalName ?? job.characterId}` : job.kind === 'chapter-audio' ? `Audio · ${data.book.chapters.find((item) => item.id === job.chapterId)?.title ?? 'Chapter'}` : data.book.chapters.find((item) => item.id === job.chapterId)?.title ?? 'Chapter performance'}</strong><span>{job.status === 'queued' ? `Queued${job.queuePosition ? ` · position ${job.queuePosition}` : ''}` : 'Generating now'}</span></div>
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
          <div class="script-scroll" bind:this={scriptScroll}>
            {#each rendered.utterances as item, index}
              <button data-utterance-index={index} class:active={index === activeIndex} class="utterance" onclick={() => void selectUtterance(index)}>
                <span class="speaker">{item.utterance.speakerCharacterId ? data.book.characters.find((character) => character.id === item.utterance.speakerCharacterId)?.canonicalName ?? item.utterance.speakerCharacterId : 'Narrator'}</span>
                <span class="spoken-text">{item.utterance.text}</span>
                <span class="direction">{item.utterance.direction.emotion} · {item.utterance.direction.pace}<i class:exact={item.alignment === 'exact'}>{item.alignment}</i></span>
              </button>
            {/each}
          </div>
        </div>
      </section>

      {#if activeUtterance}
        <audio bind:this={audio} src={activeUtterance.audio.path} ontimeupdate={(event) => activeTimeMs = event.currentTarget.currentTime * 1000} onplay={() => playing = true} onpause={() => playing = false} onerror={() => playing = false} onended={() => void nextUtterance(true)}></audio>
      {/if}
      <section class="transport">
        <button class="round-button" onclick={() => void selectUtterance(Math.max(0, activeIndex - 1))} aria-label="Previous passage">‹</button>
        <button class="play-button" onclick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button class="round-button" onclick={() => void nextUtterance()} aria-label="Next passage">›</button>
        <span class="timecode">{formatTime(globalTime)}</span>
        <input class="timeline" type="range" min="0" max="100" step="0.05" value={progress} oninput={seek} aria-label="Chapter progress" />
        <span class="timecode">{formatTime(rendered.totalDurationMs)}</span>
        <span class="voice-chip">◉ {activeUtterance?.voice?.voiceId ?? (activeUtterance?.utterance.speakerCharacterId ? 'Character voice' : 'Narrator')}</span>
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
            {@const voice = data.book.voices.find((profile) => profile.characterId === character.id)}
            <article class="character-card">
              {#if character.referenceImages[0]}<img src={character.referenceImages[0].path} alt={`${character.canonicalName} reference`} />{:else}<div class="character-placeholder">{character.canonicalName.slice(0, 1)}</div>{/if}
              <div><strong>{character.canonicalName}</strong><span>{character.narrativeRole}</span><p>{character.physicalDescription}</p>{#if voice}<small>Voice · {voice.voiceId} · {voice.gender}</small>{/if}<button class="debug-action" onclick={() => regenerateCharacter(character.id)} disabled={activeJobs.some((job) => job.kind === 'character-reference' && job.characterId === character.id)}>Regenerate reference</button></div>
            </article>
          {/each}
        </div>
      {:else}
        <div class="registry-empty"><span>Characters will appear here after the registry pass.</span><button class="text-button" onclick={prepareRegistry} disabled={registryJobActive}>Build character registry</button></div>
      {/if}
    </section>

    {#if data.book.worldElements.length}
      <section class="character-section">
        <div class="section-title"><div><p class="eyebrow">Continuity anchors</p><h2>World registry</h2></div><span>{data.book.worldElements.length} selected places and objects</span></div>
        <div class="character-row">
          {#each data.book.worldElements as element}
            <article class="character-card">
              {#if element.referenceImages[0]}<img src={element.referenceImages[0].path} alt={`${element.canonicalName} reference`} />{:else}<div class="character-placeholder">Queued for illustrated reference</div>{/if}
              <div><strong>{element.canonicalName}</strong><span>{element.kind} · {element.referencePriority}</span><p>{element.visualDescription}</p></div>
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </main>
</div>

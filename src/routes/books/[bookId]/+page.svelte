<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { jobPercent, stepBarKind, stepPercent } from '$lib/core/progress';
  import type { GenerationJob, QueueSnapshot, RenderedChapter } from '$lib/core/schemas';

  let { data } = $props();
  let rendered = $state<RenderedChapter | null>(null);
  let jobs = $state<GenerationJob[]>([]);
  let queue = $state<QueueSnapshot | null>(null);
  let requestError = $state('');
  let activeIndex = $state(0);
  let activeTimeMs = $state(0);
  let playing = $state(false);
  let audio = $state<HTMLAudioElement>();
  let previewAudio = $state<HTMLAudioElement>();
  let previewJobId = $state<string>();
  let previewIndex = $state(0);
  let previewTimeMs = $state(0);
  let previewPlaying = $state(false);
  let previewWaiting = $state(false);
  let scriptScroll = $state<HTMLDivElement>();
  let loadedChapterId = $state<string>();
  let viewMode = $state<'read' | 'performance'>('read');
  let autoOpenedPreviewJobId = $state<string>();
  let lastSavedCursor = '';
  let playbackChangeId = 0;
  let previewPlaybackChangeId = 0;

  const chapter = $derived(data.book.chapters.find((item) => item.id === data.chapterId));
  const activeUtterance = $derived(rendered?.utterances[activeIndex]);
  const globalTime = $derived((activeUtterance?.startMs ?? 0) + activeTimeMs);
  const activeVisual = $derived(rendered?.visuals.filter((visual) => visual.startMs <= globalTime).at(-1) ?? rendered?.visuals[0]);
  const progress = $derived(rendered ? Math.min(100, globalTime / rendered.totalDurationMs * 100) : 0);
  const activeJobs = $derived(jobs.filter((job) => job.status === 'queued' || job.status === 'active'));
  const storyJobActive = $derived(activeJobs.some((job) => job.kind === 'story'));
  const storySourceReady = $derived(data.book.origin.kind !== 'generated' || data.book.origin.status === 'ready');
  const workerCommand = $derived(data.runtime.mode === 'mock' ? 'pnpm worker' : `pnpm worker:${data.runtime.mode}`);
  const chapterJobActive = $derived(activeJobs.some((job) => (job.kind === 'chapter' || job.kind === 'chapter-audio') && job.chapterId === data.chapterId));
  const audioJobActive = $derived(activeJobs.some((job) => job.kind === 'chapter-audio' && job.chapterId === data.chapterId));
  const registryJobActive = $derived(activeJobs.some((job) => job.kind === 'registry'));
  const latestRelevantJob = $derived(jobs.find((job) => job.kind === 'story' || ((job.kind === 'chapter' || job.kind === 'chapter-audio') && job.chapterId === data.chapterId) || job.kind === 'registry' || job.kind === 'character-reference'));
  const failedJob = $derived(latestRelevantJob?.status === 'failed' ? latestRelevantJob : undefined);
  const previewJob = $derived(activeJobs.find((job) =>
    (job.kind === 'chapter' || job.kind === 'chapter-audio')
    && job.chapterId === data.chapterId
    && (job.chapterPlan || job.audioPreview.length > 0)
  ));
  const previewPlan = $derived(previewJob?.chapterPlan);
  const previewPassages = $derived(previewJob?.audioPreview ?? []);
  const previewPassage = $derived(previewPassages[previewIndex]);
  const previewSpeechStep = $derived(previewJob?.steps.find((step) => step.id === 'speech'));
  const previewVisual = $derived(previewJob?.visualPreview.at(-1));
  // Work queued with nothing draining it would wait forever and look like a hang.
  const stranded = $derived(Boolean(activeJobs.length && queue && !queue.hasWorker));
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
      const savedProgress = data.playbackProgress;
      const savedIndex = nextRendered && savedProgress
        ? nextRendered.utterances.findIndex((item) => item.utterance.id === savedProgress.utteranceId)
        : -1;
      activeIndex = Math.max(0, savedIndex);
      activeTimeMs = savedIndex >= 0 && savedProgress ? Math.min(savedProgress.positionMs, nextRendered!.utterances[savedIndex].durationMs) : 0;
      playing = false;
      viewMode = nextRendered ? 'performance' : 'read';
    }
  });

  $effect(() => {
    jobs = data.jobs;
    queue = data.queue;
  });

  $effect(() => {
    if (!rendered && previewPlan && previewJob && autoOpenedPreviewJobId !== previewJob.id) {
      autoOpenedPreviewJobId = previewJob.id;
      viewMode = 'performance';
    }
  });

  $effect(() => {
    const jobId = previewJob?.id;
    const available = previewPassages.length;
    if (!jobId) {
      if (previewJobId) {
        previewPlaybackChangeId += 1;
        previewAudio?.pause();
        previewJobId = undefined;
        previewIndex = 0;
        previewTimeMs = 0;
        previewPlaying = false;
        previewWaiting = false;
      }
      return;
    }
    if (previewJobId !== jobId) {
      previewPlaybackChangeId += 1;
      previewAudio?.pause();
      previewJobId = jobId;
      previewIndex = 0;
      previewTimeMs = 0;
      previewPlaying = false;
      previewWaiting = false;
      return;
    }
    if (previewIndex >= available) previewIndex = Math.max(0, available - 1);
    if (previewWaiting && available > previewIndex + 1) {
      previewWaiting = false;
      void selectPreview(previewIndex + 1, true);
    }
  });

  $effect(() => {
    const index = activeIndex;
    rendered?.chapterId;
    if (viewMode !== 'performance') return;
    requestAnimationFrame(() => {
      const active = scriptScroll?.querySelector<HTMLElement>(`[data-utterance-index="${index}"]`);
      if (!active || !scriptScroll) return;
      const viewport = scriptScroll.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const transportTop = document.querySelector<HTMLElement>('.transport')?.getBoundingClientRect().top ?? viewport.bottom;
      const safeTop = viewport.top + 16;
      const safeBottom = Math.min(viewport.bottom - 16, transportTop - 12);
      if (item.bottom > safeBottom) scriptScroll.scrollBy({ top: item.bottom - safeBottom, behavior: playing ? 'smooth' : 'auto' });
      else if (item.top < safeTop) scriptScroll.scrollBy({ top: item.top - safeTop, behavior: playing ? 'smooth' : 'auto' });
    });
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (activeJobs.length) void refreshJobs();
    }, 1200);
    const saveOnExit = () => persistPlaybackProgress(true);
    window.addEventListener('pagehide', saveOnExit);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', saveOnExit);
    };
  });

  async function refreshJobs() {
    const hadActiveJobs = activeJobs.length > 0;
    try {
      const response = await fetch(`/api/jobs?bookId=${encodeURIComponent(data.book.id)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as { jobs: GenerationJob[]; queue: QueueSnapshot };
      jobs = payload.jobs;
      queue = payload.queue;
      if (hadActiveJobs && !jobs.some((job) => job.status === 'queued' || job.status === 'active')) await invalidateAll();
    } catch {
      // A transient polling failure should not hide the last reported progress.
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

  async function retryStory() {
    await request(`/api/books/${data.book.id}/story`);
  }

  /** Resumes the failed job itself, so its plan and finished passages are not paid for twice. */
  async function resumeJob(jobId: string) {
    await request(`/api/jobs/${jobId}/resume`);
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

  async function assignVoice(event: SubmitEvent, voiceId: string) {
    event.preventDefault();
    const characterId = String(new FormData(event.currentTarget as HTMLFormElement).get('characterId'));
    requestError = '';
    const response = await fetch(`/api/books/${data.book.id}/voices/${encodeURIComponent(characterId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voiceId })
    });
    const payload = await response.json();
    if (!response.ok) { requestError = payload.message ?? payload.error ?? 'Voice assignment failed'; return; }
    await invalidateAll();
  }

  async function deleteBook() {
    if (activeJobs.length) { requestError = 'Wait for the active generation job before deleting the book.'; return; }
    if (!confirm(`Remove “${data.book.title}” and all its generated artifacts from the library? It will be moved to Storyloom's recoverable data trash.`)) return;
    const response = await fetch(`/api/books/${data.book.id}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) { requestError = payload.error ?? 'Book deletion failed'; return; }
    await goto('/');
  }

  function persistPlaybackProgress(keepalive = false) {
    if (!activeUtterance || !rendered) return;
    const payload = {
      utteranceId: activeUtterance.utterance.id,
      positionMs: Math.max(0, Math.round(activeTimeMs))
    };
    const signature = `${rendered.chapterId}:${payload.utteranceId}:${Math.floor(payload.positionMs / 1000)}`;
    if (signature === lastSavedCursor) return;
    lastSavedCursor = signature;
    void fetch(`/api/books/${data.book.id}/chapters/${rendered.chapterId}/progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive
    }).catch(() => { lastSavedCursor = ''; });
  }

  async function togglePreviewPlayback() {
    if (!previewAudio || !previewPassage) return;
    previewPlaybackChangeId += 1;
    previewWaiting = false;
    if (previewPlaying) {
      previewAudio.pause();
      previewPlaying = false;
      return;
    }
    audio?.pause();
    playing = false;
    try {
      await previewAudio.play();
      previewPlaying = true;
    } catch {
      previewPlaying = false;
    }
  }

  async function selectPreview(index: number, resume = previewPlaying) {
    if (!previewPassages[index]) return;
    const changeId = ++previewPlaybackChangeId;
    previewAudio?.pause();
    audio?.pause();
    playing = false;
    previewPlaying = false;
    previewWaiting = false;
    previewIndex = index;
    previewTimeMs = 0;
    await tick();
    if (changeId !== previewPlaybackChangeId || !previewAudio) return;
    previewAudio.currentTime = 0;
    if (!resume) return;
    try {
      await previewAudio.play();
      if (changeId === previewPlaybackChangeId) previewPlaying = true;
    } catch {
      if (changeId === previewPlaybackChangeId) previewPlaying = false;
    }
  }

  async function nextPreview(resume = previewPlaying) {
    if (previewIndex < previewPassages.length - 1) {
      await selectPreview(previewIndex + 1, resume);
      return;
    }
    previewPlaying = false;
    previewWaiting = resume;
  }

  async function togglePlayback() {
    if (!audio || !activeUtterance) return;
    playbackChangeId += 1;
    previewPlaybackChangeId += 1;
    previewAudio?.pause();
    previewPlaying = false;
    previewWaiting = false;
    if (playing) {
      audio.pause();
      playing = false;
      persistPlaybackProgress();
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
    persistPlaybackProgress();
    const changeId = ++playbackChangeId;
    audio?.pause();
    previewPlaybackChangeId += 1;
    previewAudio?.pause();
    previewPlaying = false;
    previewWaiting = false;
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
      persistPlaybackProgress();
    } else { playing = false; persistPlaybackProgress(); }
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
    <div class="mobile-topbar">
      <a class="mobile-library-link" href="/" aria-label="Back to library">←</a>
      <a class="brand compact" href="/"><span class="brand-mark">S</span><span>Storyloom</span></a>
      <details class="mobile-menu">
        <summary aria-label="Open book navigation">Menu</summary>
        <div class="mobile-menu-panel">
          <strong>{data.book.title}</strong>
          <nav aria-label="Chapters">
            {#each data.book.chapters as item}
              <a class:active={item.id === data.chapterId} href={`/books/${data.book.id}?chapter=${item.id}`}>
                <span>{String(item.order + 1).padStart(2, '0')}</span>{item.title}
              </a>
            {/each}
          </nav>
          <div class="mobile-menu-links"><a href="/jobs">Job queue</a><a href="/settings">Settings</a></div>
          {#if data.runtime.technicalUi}<button class="danger-button" onclick={deleteBook} disabled={activeJobs.length > 0}>Move book to trash</button>{/if}
        </div>
      </details>
    </div>
    <div class="desktop-sidebar-content">
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
      <nav class="side-links"><a href="/jobs">Job queue</a><a href="/settings">Settings</a></nav>
      {#if data.runtime.technicalUi}<button class="danger-button" onclick={deleteBook} disabled={activeJobs.length > 0}>Move book to trash</button>{/if}
    </div>
  </aside>

  <main class="studio-main">
    <header class="studio-header">
      <div><p class="eyebrow">{chapter ? `Chapter ${chapter.order + 1}` : 'Source manuscript'}</p><h1>{chapter?.title ?? data.book.title}</h1></div>
    </header>

    {#if chapter && (rendered || previewPlan || data.runtime.technicalUi)}
      <div class="chapter-view-bar">
        {#if rendered || previewPlan}
          <div class="reading-mode-switch" aria-label="Chapter view">
            <button class:active={viewMode === 'read'} onclick={() => viewMode = 'read'}>Read</button>
            <button class:active={viewMode === 'performance'} onclick={() => viewMode = 'performance'}>Watch & listen</button>
          </div>
        {/if}
        {#if data.runtime.technicalUi}
          <details class="chapter-tools">
            <summary>Chapter options</summary>
            <div>
              <p>{data.book.registryStatus === 'ready' && !visualReferencesOutdated ? 'The cast and recurring places are ready, helping scenes stay visually consistent.' : visualReferencesOutdated ? 'Some illustrated references need to be refreshed before the next generation.' : 'Storyloom is still preparing the cast and recurring places.'}</p>
              {#if rendered}<p>{rendered.utterances.every((item) => item.alignment === 'exact') ? 'Text timing is exact.' : 'Text highlighting uses approximate timing.'}</p>{/if}
              {#if data.book.registryStatus !== 'ready'}
                <button class="secondary-button" onclick={prepareRegistry} disabled={registryJobActive}>Build cast & places</button>
              {:else if visualReferencesOutdated}
                <button class="secondary-button" onclick={prepareRegistry} disabled={registryJobActive}>Refresh illustrated references</button>
              {/if}
              {#if rendered}<button class="secondary-button" onclick={regenerateAudio} disabled={chapterJobActive}>{audioJobActive ? 'Regenerating audio…' : 'Regenerate all audio'}</button><button class="secondary-button" onclick={regenerateChapter} disabled={chapterJobActive}>Regenerate chapter</button>{/if}
            </div>
          </details>
        {/if}
      </div>
    {/if}

    {#if activeJobs.length}
      <section class="jobs-panel" aria-live="polite">
        <div class="jobs-heading"><div class="spinner"></div><div><strong>Storyloom is working on your book</strong><span>Everything is saved as it goes. You can reload this page, or come back later, without losing what is done.</span></div></div>
        {#if stranded}
          <p class="queue-warning">No worker is draining the queue, so this job will wait until one is. {data.workerMode === 'inline' ? 'The web process should be running a worker — check its logs.' : `Start \`${workerCommand}\` on the machine that runs inference.`}</p>
        {/if}
        {#each activeJobs as job}
          <article class="job-card">
            <div class="job-summary">
              <div><strong>{job.kind === 'story' ? 'Writing the manuscript' : job.kind === 'registry' ? 'Getting to know the book' : job.kind === 'character-reference' ? `Character portrait · ${data.book.characters.find((character) => character.id === job.characterId)?.canonicalName ?? job.characterId}` : job.kind === 'chapter-audio' ? `Voices · ${data.book.chapters.find((item) => item.id === job.chapterId)?.title ?? 'Chapter'}` : data.book.chapters.find((item) => item.id === job.chapterId)?.title ?? 'Chapter performance'}</strong><span>{job.status === 'queued' ? `Waiting to start${job.queuePosition ? ` · number ${job.queuePosition} in line` : ''}` : 'In progress'}</span></div>
              <b>{jobPercent(job)}%</b>
            </div>
            <div class="job-progress"><i style={`width: ${jobPercent(job)}%`}></i></div>
            <ol class="job-steps">
              {#each job.steps as item}
                <li class:done={item.status === 'completed'} class:current={item.status === 'running'} class:failed={item.status === 'failed'}>
                  <i>{item.status === 'completed' ? '✓' : item.status === 'running' ? '•' : item.status === 'failed' ? '!' : '○'}</i>
                  <div><span>{item.label}</span>{#if item.detail}<small>{item.detail}</small>{/if}{#if stepBarKind(item)}<div class="job-step-progress" class:waiting={stepBarKind(item) === 'waiting'} role="progressbar" aria-label={`Progress: ${item.label}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={stepPercent(item)}><i style={`width: ${stepPercent(item)}%`}></i></div>{/if}</div>
                  {#if item.total > 1}<b>{item.completed}/{item.total}</b>{/if}
                </li>
              {/each}
            </ol>
          </article>
        {/each}
      </section>
    {:else if requestError || failedJob}
      <section class="error-panel">
        <strong>Something stopped the pipeline</strong>
        <span>{requestError || failedJob?.error}</span>
        {#if failedJob}<button class="secondary-button" onclick={() => resumeJob(failedJob.id)}>Resume where it stopped</button>{/if}
      </section>
    {/if}

    {#if chapter && viewMode === 'read'}
      <section class="source-reader">
        <div class="source-reader-heading">
          <div><span>{data.book.origin.kind === 'generated' ? 'AI-authored source text' : 'Original source text'}</span><small>{chapter.text.trim().split(/\s+/).length.toLocaleString()} words · media not required</small></div>
          {#if rendered || previewPlan}<button class="secondary-button" onclick={() => viewMode = 'performance'}>{rendered ? 'Open performance' : 'Open live performance'} →</button>{/if}
        </div>
        <article class="source-prose">
          <h2>{chapter.title}</h2>
          {#each chapter.text.split(/\n{2,}/) as paragraph}<p>{paragraph}</p>{/each}
        </article>
        {#if !rendered && data.runtime.technicalUi}
          <div class="augment-callout">
            <div><strong>{storySourceReady ? 'Ready to augment this chapter?' : 'Finish the source manuscript first'}</strong><span>{storySourceReady ? 'Voices, acting directions and scenes are generated separately. This readable source text will not be rewritten.' : 'Completed chapters are already safe and readable. Resume to generate only the missing chapters.'}</span></div>
            {#if storySourceReady}
              <button class="primary-button" onclick={prepareChapter} disabled={chapterJobActive}>{chapterJobActive ? 'Chapter queued or generating…' : 'Generate augmented chapter'} <span>→</span></button>
            {:else}
              <button class="primary-button" onclick={retryStory} disabled={storyJobActive}>{storyJobActive ? 'Story generation in progress…' : 'Resume story generation'} <span>→</span></button>
            {/if}
          </div>
        {/if}
      </section>
    {:else if rendered && !previewPlan}
      <section class="experience-grid">
        <div class="visual-stage">
          {#if activeVisual}<img src={activeVisual.image.path} alt={activeVisual.cue.prompt} />{/if}
          <div class="visual-overlay"><span>SCENE {Math.max(1, (rendered.visuals.indexOf(activeVisual!) + 1)).toString().padStart(2, '0')}</span><small>{activeVisual?.cue.shot}</small></div>
          <div class="image-dots">{#each rendered.visuals as visual}<i class:active={visual.cue.id === activeVisual?.cue.id}></i>{/each}</div>
        </div>

        <div class="reading-panel">
          <div class="script-scroll" bind:this={scriptScroll}>
            {#each rendered.utterances as item, index}
              <button data-utterance-index={index} class:active={index === activeIndex} class="utterance" onclick={() => void selectUtterance(index)}>
                <span class="speaker">{item.utterance.speakerCharacterId ? data.book.characters.find((character) => character.id === item.utterance.speakerCharacterId)?.canonicalName ?? item.utterance.speakerCharacterId : 'Narrator'}</span>
                <span class="spoken-text">{item.utterance.text}</span>
              </button>
            {/each}
          </div>
        </div>
      </section>

      {#if activeUtterance}
        <audio bind:this={audio} src={activeUtterance.audio.path} onloadedmetadata={(event) => event.currentTarget.currentTime = Math.min(activeTimeMs / 1000, event.currentTarget.duration || Infinity)} ontimeupdate={(event) => activeTimeMs = event.currentTarget.currentTime * 1000} onplay={() => playing = true} onpause={() => { playing = false; persistPlaybackProgress(); }} onerror={() => playing = false} onended={() => void nextUtterance(true)}></audio>
      {/if}
      <section class="transport">
        <button class="round-button" onclick={() => void selectUtterance(Math.max(0, activeIndex - 1))} aria-label="Previous passage">‹</button>
        <button class="play-button" onclick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button class="round-button" onclick={() => void nextUtterance()} aria-label="Next passage">›</button>
        <span class="timecode">{formatTime(globalTime)}</span>
        <input class="timeline" type="range" min="0" max="100" step="0.05" value={progress} oninput={seek} onchange={() => persistPlaybackProgress()} aria-label="Chapter progress" />
        <span class="timecode">{formatTime(rendered.totalDurationMs)}</span>
      </section>
    {:else if previewPlan && previewJob}
      <section class="experience-grid incremental-experience">
        <div class="visual-stage incremental-visual">
          {#if previewVisual}
            <img src={previewVisual.image.path} alt={previewVisual.cue.prompt} />
            <div class="visual-overlay"><span>LIVE SCENE {previewJob.visualPreview.length.toString().padStart(2, '0')}</span><small>{previewVisual.cue.shot}</small></div>
          {:else}
            <div class="scene-placeholder"><div class="spinner"></div><strong>Scenes are being staged</strong><span>Audio can be heard before the first image is ready.</span></div>
          {/if}
          <div class="image-dots">{#each previewPlan.visuals as cue}<i class:active={previewJob.visualPreview.some((visual) => visual.cue.id === cue.id)}></i>{/each}</div>
        </div>

        <div class="reading-panel">
          <div class="reading-heading"><span>Live performance script</span><small>{previewPassages.length}/{previewSpeechStep?.total ?? previewPlan.utterances.length} audio tracks ready</small></div>
          <div class="script-scroll" bind:this={scriptScroll}>
            {#each previewPlan.utterances as utterance}
              {@const trackIndex = previewPassages.findIndex((item) => item.utterance.id === utterance.id)}
              {@const track = trackIndex >= 0 ? previewPassages[trackIndex] : undefined}
              {@const aligned = previewJob.alignedPreview.find((item) => item.utterance.id === utterance.id)}
              <button class="utterance incremental-track" class:active={trackIndex === previewIndex && Boolean(track)} class:ready={Boolean(track)} disabled={!track} onclick={() => void selectPreview(trackIndex)}>
                <span class="speaker">{utterance.speakerCharacterId ? data.book.characters.find((character) => character.id === utterance.speakerCharacterId)?.canonicalName ?? utterance.speakerCharacterId : 'Narrator'}</span>
                <span class="spoken-text">{utterance.text}</span>
                <span class="direction">{utterance.direction.emotion} · {utterance.direction.pace}<i class:exact={aligned?.alignment === 'exact'}>{aligned ? aligned.alignment : track ? 'audio ready · alignment pending' : 'audio pending'}</i></span>
              </button>
            {/each}
          </div>
        </div>
      </section>

      {#if previewPassage}
        <audio bind:this={previewAudio} src={previewPassage.audio.path} ontimeupdate={(event) => previewTimeMs = event.currentTarget.currentTime * 1000} onplay={() => previewPlaying = true} onpause={() => previewPlaying = false} onerror={() => previewPlaying = false} onended={() => void nextPreview(true)}></audio>
      {/if}
      <section class="transport live-transport">
        <button class="round-button" onclick={() => void selectPreview(Math.max(0, previewIndex - 1), previewPlaying)} disabled={!previewPassage || previewIndex === 0} aria-label="Previous generated passage">‹</button>
        <button class="play-button" onclick={togglePreviewPlayback} disabled={!previewPassage} aria-label={previewPlaying ? 'Pause audio preview' : 'Play audio preview'}>{previewPlaying ? 'Ⅱ' : '▶'}</button>
        <button class="round-button" onclick={() => void nextPreview(previewPlaying)} disabled={!previewPassage || previewIndex >= previewPassages.length - 1} aria-label="Next generated passage">›</button>
        <span class="timecode">{formatTime(previewTimeMs)}</span>
        <div class="live-track-progress"><i style={`width: ${previewPassage ? Math.min(100, previewTimeMs / previewPassage.durationMs * 100) : 0}%`}></i></div>
        <span class="timecode">{formatTime(previewPassage?.durationMs ?? 0)}</span>
        <span class="voice-chip">{previewWaiting ? 'Waiting for the next track…' : previewPassage ? `Track ${previewIndex + 1} · ${previewPassages.length} ready` : 'First audio track pending'}</span>
      </section>
    {:else if !chapter}
      <section class="empty-experience">
        <div class="empty-art"><span>✦</span><i></i><i></i><i></i></div>
        <p class="eyebrow">Generative manuscript</p>
        <h2>{storyJobActive ? 'The writer is building your story' : 'The manuscript is incomplete'}</h2>
        <p>{storyJobActive ? 'Storyloom is designing the full arc and writing each complete source chapter in order. The book will become readable before any voice or image is required.' : `No complete chapter is available yet. ${data.book.origin.kind === 'generated' ? `${data.book.chapters.length} of ${data.book.origin.requestedChapterCount} chapters are safely stored.` : ''}`}</p>
        {#if data.book.origin.kind === 'generated' && !storyJobActive}<button class="primary-button wide" onclick={retryStory}>Resume story generation <span>→</span></button>{/if}
        <div class="pipeline-preview"><span>Outline</span><b>→</b><span>Write chapters</span><b>→</b><span>Read</span><b>→</b><span>Augment on demand</span></div>
      </section>
    {/if}

    {#if data.book.chapters.length}<section class="character-section">
      <div class="section-title"><div><p class="eyebrow">Source of truth</p><h2>Character registry</h2></div><span>{data.book.characters.length} locked identities</span></div>
      {#if data.book.characters.length}
        <div class="character-row">
          {#each data.book.characters as character}
            {@const voice = data.book.voices.find((profile) => profile.characterId === character.id)}
            <article class="character-card">
              {#if character.referenceImages[0]}<img src={character.referenceImages[0].path} alt={`${character.canonicalName} reference`} />{:else}<div class="character-placeholder">{character.canonicalName.slice(0, 1)}</div>{/if}
              <div><strong>{character.canonicalName}</strong><span>{character.narrativeRole}</span><p>{character.physicalDescription}</p>{#if voice}<small>Voice · {voice.voiceId} · {voice.gender}</small>{/if}{#if data.runtime.technicalUi}<button class="debug-action" onclick={() => regenerateCharacter(character.id)} disabled={activeJobs.some((job) => job.kind === 'character-reference' && job.characterId === character.id)}>Regenerate reference</button>{/if}</div>
            </article>
          {/each}
        </div>
      {:else}
        <div class="registry-empty"><span>Characters will appear here after the registry pass.</span>{#if data.runtime.technicalUi && storySourceReady}<button class="text-button" onclick={prepareRegistry} disabled={registryJobActive}>Build character registry</button>{/if}</div>
      {/if}
    </section>{/if}

    {#if data.runtime.technicalUi && data.voiceCandidates.length}
      <section class="character-section voice-lab-section">
        <div class="section-title"><div><p class="eyebrow">Technical voice lab</p><h2>Synthetic voice references</h2></div><span>Qwen VoiceDesign → Chatterbox clone</span></div>
        <p class="voice-lab-note">These are fictional, locally generated identities. The reference determines timbre; Chatterbox determines how each chapter passage is sustained and interpreted. Existing chapter audio must be regenerated after changing the catalog.</p>
        <div class="voice-candidate-grid">
          {#each data.voiceCandidates as candidate}
            <article class="voice-candidate-card">
              <div><strong>{candidate.label}</strong><span>{candidate.role} · {candidate.gender}</span></div>
              <div class="voice-sample"><span>1 · Qwen VoiceDesign reference</span><audio controls preload="none" src={`/api/voice-catalog/${candidate.id}`}></audio></div>
              {#if candidate.auditionFile}<div class="voice-sample"><span>2 · Chatterbox clone</span><audio controls preload="none" src={`/api/voice-catalog/${candidate.id}?kind=audition`}></audio></div>{/if}
              <form class="voice-assignment" onsubmit={(event) => assignVoice(event, candidate.id)}>
                <select name="characterId" aria-label={`Assign ${candidate.label} to`}>
                  <option value="narrator">Narrator</option>
                  {#each data.book.characters.filter((character) => ['unknown', 'neutral', candidate.gender].includes(character.voiceGender)) as character}
                    <option value={character.id}>{character.canonicalName}</option>
                  {/each}
                </select>
                <button class="debug-action" type="submit">Assign for next audio regeneration</button>
              </form>
              <details><summary>Voice design provenance</summary><small>Model · {candidate.sourceModel}</small><p><b>Language conditioning</b> · {candidate.language ?? 'legacy reference: invalid short code “it”, effectively auto'}</p><p><b>Prompt</b> · {candidate.prompt}</p><p><b>Reference text</b> · {candidate.referenceText}</p><p><b>Seed</b> · {candidate.seed}</p></details>
            </article>
          {/each}
        </div>
      </section>
    {/if}

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

<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { RenderedChapter } from '$lib/core/schemas';

  let { data } = $props();
  let rendered = $state<RenderedChapter | null>(null);
  let working = $state(false);
  let status = $state('');
  let activeIndex = $state(0);
  let activeTimeMs = $state(0);
  let playing = $state(false);
  let audio = $state<HTMLAudioElement>();

  const chapter = $derived(data.book.chapters.find((item) => item.id === data.chapterId));
  const activeUtterance = $derived(rendered?.utterances[activeIndex]);
  const globalTime = $derived((activeUtterance?.startMs ?? 0) + activeTimeMs);
  const activeVisual = $derived(rendered?.visuals.filter((visual) => visual.startMs <= globalTime).at(-1) ?? rendered?.visuals[0]);
  const progress = $derived(rendered ? Math.min(100, globalTime / rendered.totalDurationMs * 100) : 0);

  $effect(() => {
    if (!rendered && data.rendered) rendered = data.rendered;
  });

  async function request(path: string, message: string) {
    working = true; status = message;
    const response = await fetch(path, { method: 'POST' });
    const payload = await response.json();
    working = false;
    if (!response.ok) { status = payload.error ?? 'Generation failed'; return null; }
    status = '';
    return payload;
  }

  async function prepareRegistry() {
    const result = await request(`/api/books/${data.book.id}/registry`, 'Reading every chapter and locking character identities…');
    if (result) await invalidateAll();
  }

  async function prepareChapter() {
    const result = await request(`/api/books/${data.book.id}/chapters/${data.chapterId}/prepare`, 'Directing voices, scenes and timing for this chapter…');
    if (result) { rendered = result; activeIndex = 0; activeTimeMs = 0; }
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
    <div class="runtime-card"><span><i></i> Runtime</span><strong>Demo provider</strong><small>Configure local or cloud models in .env</small></div>
  </aside>

  <main class="studio-main">
    <header class="studio-header">
      <div><p class="eyebrow">Chapter {chapter ? chapter.order + 1 : ''}</p><h1>{chapter?.title}</h1></div>
      <div class="header-actions">
        <span class:ready={data.book.registryStatus === 'ready'} class="registry-badge">{data.book.registryStatus === 'ready' ? '✓ Character registry ready' : 'Character registry pending'}</span>
        {#if data.book.registryStatus !== 'ready'}<button class="secondary-button" onclick={prepareRegistry} disabled={working}>Build registry</button>{/if}
      </div>
    </header>

    {#if working}
      <section class="working-panel"><div class="spinner"></div><div><strong>{status}</strong><span>This can take a while with local models. The result is cached.</span></div></section>
    {:else if status}
      <section class="error-panel"><strong>Something stopped the pipeline</strong><span>{status}</span></section>
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
        <button class="primary-button wide" onclick={prepareChapter} disabled={working}>Prepare this chapter <span>→</span></button>
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
        <div class="registry-empty"><span>Characters will appear here after the registry pass.</span><button class="text-button" onclick={prepareRegistry}>Build character registry</button></div>
      {/if}
    </section>
  </main>
</div>

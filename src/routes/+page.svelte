<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { signOut } from '$lib/auth-client';
  let { data, form } = $props();
  let uploading = $state(false);
  let generating = $state(false);
  let creationMode = $state<'generate' | 'upload'>('generate');
  const seoTitle = 'Storyloom Studio — Turn books into audiovisual chapters';
  const seoDescription = 'Import EPUB, PDF or TXT books, or write a new story with AI. Generate private, synchronized narration and cinematic scenes one chapter at a time with your own OpenRouter key or a self-hosted stack.';
  const jsonLd = $derived(JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Storyloom Studio',
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Web, macOS, Linux',
        url: data.marketing.publicUrl,
        description: seoDescription,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        isAccessibleForFree: true,
        codeRepository: 'https://github.com/epavanello/storyloom-studio',
        featureList: ['EPUB, PDF and TXT import', 'AI story writing', 'On-demand chapter narration', 'Character-consistent scene generation', 'Bring your own OpenRouter key', 'Local self-hosting']
      },
      {
        '@type': 'WebSite',
        name: 'Storyloom Studio',
        url: data.marketing.publicUrl
      }
    ]
  }).replace(/</g, '\\u003c'));
</script>

<svelte:head>
  <title>{data.user ? 'Your library · Storyloom' : seoTitle}</title>
  <meta name="description" content={seoDescription} />
  <link rel="canonical" href={data.marketing.publicUrl} />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="sitemap" href="/sitemap.xml" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Storyloom Studio" />
  <meta property="og:title" content={seoTitle} />
  <meta property="og:description" content={seoDescription} />
  <meta property="og:url" content={data.marketing.publicUrl} />
  <meta property="og:image" content={`${data.marketing.publicUrl}/og.png`} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={seoTitle} />
  <meta name="twitter:description" content={seoDescription} />
  <meta name="twitter:image" content={`${data.marketing.publicUrl}/og.png`} />
  {#if !data.user}{@html `<script type="application/ld+json">${jsonLd}<\/script>`}{/if}
</svelte:head>

{#if data.user}
<main class="landing-shell">
  <header class="brand-bar">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <nav class="account-nav">
      <a href="/jobs">Jobs</a>
      <a href="/settings">Settings</a>
      {#if data.user}<span class="account-email">{data.user.email}</span>{/if}
      <button class="text-button" onclick={() => signOut().then(() => goto('/'))}>Sign out</button>
    </nav>
  </header>

  <section class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Books, staged in time</p>
      <h1>Listen to the page.<br /><em>See the story.</em></h1>
      <p class="lede">A private, local-first studio that turns a book into expressive narration and character-consistent scenes—one chapter at a time.</p>
      <div class="trust-row"><span>EPUB</span><span>PDF</span><span>TXT</span><span>On-demand generation</span></div>
    </div>

    <div class="import-card creation-card">
      <div class="card-heading"><span>New story</span><small>STEP 01</small></div>
      <div class="creation-tabs" role="tablist" aria-label="Story source">
        <button type="button" role="tab" aria-selected={creationMode === 'generate'} class:active={creationMode === 'generate'} onclick={() => creationMode = 'generate'}>Generate with AI</button>
        <button type="button" role="tab" aria-selected={creationMode === 'upload'} class:active={creationMode === 'upload'} onclick={() => creationMode = 'upload'}>Import a book</button>
      </div>
      {#if creationMode === 'generate'}
        <form class="story-request-form" method="POST" action="?/generate" use:enhance={() => { generating = true; return async ({ update }) => { await update(); generating = false; }; }}>
          <label>
            <span>What story should Storyloom write?</span>
            <textarea name="prompt" minlength="20" maxlength="4000" rows="7" required placeholder="For example: A mystery set in a floating city, about two estranged sisters who must recover a stolen map before sunrise…">{form?.generatePrompt ?? ''}</textarea>
          </label>
          <label class="chapter-count-field">
            <span>Number of chapters</span>
            <input name="chapterCount" type="number" min="1" max="12" step="1" value={form?.generateChapterCount ?? 3} required />
          </label>
          <p class:cloud-notice={data.storyGeneration.cloudPossible} class="generation-notice">
            Writer: {data.storyGeneration.provider}. {data.storyGeneration.cloudPossible ? 'Your request and generated continuity may be sent to OpenRouter.' : 'The request stays on this deployment.'}
          </p>
          {#if form?.generateMessage}<p class="form-error">{form.generateMessage}</p>{/if}
          <button class="primary-button" disabled={generating}>{generating ? 'Starting the writer…' : 'Generate complete story'}<span>→</span></button>
        </form>
      {:else}
        <form method="POST" action="?/upload" enctype="multipart/form-data" use:enhance={() => { uploading = true; return async ({ update }) => { await update(); uploading = false; }; }}>
          <label class="drop-zone">
            <input type="file" name="book" accept=".epub,.pdf,.txt,text/plain,application/pdf,application/epub+zip" required />
            <span class="upload-icon">↥</span>
            <strong>{uploading ? 'Reading your book…' : 'Drop a book here'}</strong>
            <span>or click to choose a file · max 50 MB</span>
          </label>
          {#if form?.message}<p class="form-error">{form.message}</p>{/if}
          <button class="primary-button" disabled={uploading}>{uploading ? 'Importing…' : 'Import book'}<span>→</span></button>
        </form>
      {/if}
      <div class="or-divider"><span>or</span></div>
      <form method="POST" action="?/demo"><button class="text-button">Open the built-in demo story</button></form>
    </div>
  </section>

  {#if form?.message}<p class="form-error library-error">{form.message}</p>{/if}

  {#if data.books.length}
    <section class="library-section">
      <div class="section-title"><div><p class="eyebrow">Your shelf</p><h2>Continue listening</h2></div><span>{data.books.length} {data.books.length === 1 ? 'book' : 'books'}</span></div>
      <div class="book-grid">
        {#each data.books as book, index}
          <div class="book-slot">
            <a class="book-card" href={`/books/${book.id}`}>
              <div class="mini-cover cover-{index % 4}"><span>{book.title.slice(0, 1)}</span><small>{book.chapterCount} CHAPTERS</small></div>
              <div><strong>{book.title}</strong><span>{book.origin.kind === 'generated' && book.origin.status !== 'ready' ? `${book.chapterCount}/${book.origin.requestedChapterCount} chapters written` : book.registryStatus === 'ready' ? `${book.characterCount} characters ready` : 'Ready to read or prepare'}</span></div>
              <b>→</b>
            </a>
            <form method="POST" action="?/trash" use:enhance={() => async ({ update }) => { await update({ reset: false }); }}>
              <input type="hidden" name="bookId" value={book.id} />
              <button class="book-delete" aria-label={`Move ${book.title} to the trash`} title="Move to trash">×</button>
            </form>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if data.trashed.length}
    <section class="library-section">
      <div class="section-title"><div><p class="eyebrow">Recoverable</p><h2>Trash</h2></div><span>{data.trashed.length} {data.trashed.length === 1 ? 'book' : 'books'}</span></div>
      <p class="trash-note">Trashed books keep their renders and artifacts, so restoring one costs nothing. Deleting for good removes the generated media too.</p>
      <ul class="trash-list">
        {#each data.trashed as book}
          <li>
            <div><strong>{book.title}</strong><small>{book.chapterCount} chapters · trashed {new Date(book.trashedAt ?? book.createdAt).toLocaleDateString()}</small></div>
            <div class="trash-actions">
              <form method="POST" action="?/restore" use:enhance={() => async ({ update }) => { await update({ reset: false }); }}>
                <input type="hidden" name="bookId" value={book.id} />
                <button class="text-button">Restore</button>
              </form>
              <form
                method="POST"
                action="?/purge"
                use:enhance={() => async ({ update }) => { await update({ reset: false }); }}
                onsubmit={(event) => { if (!confirm(`Permanently delete “${book.title}” and every render and artifact generated from it? This cannot be undone.`)) event.preventDefault(); }}
              >
                <input type="hidden" name="bookId" value={book.id} />
                <button class="text-button danger">Delete for good</button>
              </form>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>
{:else}
  <main class="marketing-shell">
    <header class="marketing-nav">
      <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
      <nav aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#open-source">Open source</a>
        <a href="https://github.com/epavanello/storyloom-studio" target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
      <div class="marketing-actions">
        <a class="nav-signin" href="/auth/sign-in">Sign in</a>
        {#if data.marketing.allowSignUp}<a class="nav-cta" href="/auth/sign-up">Start creating <span>→</span></a>{/if}
      </div>
    </header>

    <section class="marketing-hero">
      <div class="marketing-hero-copy">
        <p class="eyebrow"><span class="live-dot"></span> Open-source audiovisual storytelling</p>
        <h1>Your books,<br /><em>staged in time.</em></h1>
        <p class="marketing-lede">Turn a manuscript into a chapter you can read, hear, and see. Storyloom preserves every word while it directs voices, characters, and cinematic scenes around it.</p>
        <div class="hero-actions">
          <a class="hero-primary" href={data.marketing.allowSignUp ? '/auth/sign-up' : '/auth/sign-in'}>{data.marketing.allowSignUp ? 'Create your studio' : 'Sign in to your studio'} <span>→</span></a>
          <a class="hero-secondary" href="https://github.com/epavanello/storyloom-studio" target="_blank" rel="noreferrer">Self-host on GitHub ↗</a>
        </div>
        <div class="hero-proof"><span>EPUB</span><span>PDF</span><span>TXT</span><span>BYOK OpenRouter</span><span>Local-first</span></div>
      </div>

      <div class="story-stage" role="img" aria-label="A preview of a Storyloom chapter performance at a moonlit observatory">
        <div class="stage-top"><span>THE OBSERVATORY</span><span>CHAPTER 04</span></div>
        <div class="stage-art">
          <div class="moon"></div><div class="dome"></div><div class="tower"></div><div class="beam"></div>
          <div class="stage-caption"><small>NOW NARRATING</small><strong>“The telescope began to turn by itself.”</strong></div>
        </div>
        <div class="stage-player">
          <span class="stage-play" aria-hidden="true">▶</span>
          <div><div class="stage-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span>02:18 <b>/</b> 18:42</span></div>
        </div>
        <div class="stage-note">Scene 03 <span>·</span> Anna & Marco <span>·</span> exact source text</div>
      </div>
    </section>

    <section class="manifesto-strip" aria-label="Storyloom principles">
      <p><span>01</span> Your text stays untouched</p><p><span>02</span> Generate only what you need</p><p><span>03</span> Your key, your usage</p><p><span>04</span> Self-host without a broker</p>
    </section>

    <section class="how-section" id="how-it-works">
      <div class="how-intro"><p class="eyebrow">From page to performance</p><h2>One chapter.<br /><em>Every layer in sync.</em></h2><p>Storyloom keeps creative direction inspectable and execution deterministic, so you can regenerate a voice or scene without losing the rest of the performance.</p></div>
      <div class="steps-grid">
        <article><span>01</span><h3>Bring a story</h3><p>Import EPUB, PDF, or plain text—or ask the story writer for a complete multi-chapter manuscript.</p><small>Original text preserved</small></article>
        <article><span>02</span><h3>Build the cast</h3><p>Review a stable registry for characters, voices, visual references, and continuity evidence.</p><small>Identity before imagery</small></article>
        <article><span>03</span><h3>Stage a chapter</h3><p>Generate expressive speech, aligned words, and sparse cinematic scenes only when you request them.</p><small>Granular regeneration</small></article>
      </div>
    </section>

    <section class="byok-section">
      <div class="key-visual" aria-hidden="true"><div class="key-card"><span>OPENROUTER</span><strong>sk-or-v1-••••••••7f2a</strong><small>Encrypted for your account</small></div><div class="key-seal">S</div></div>
      <div class="byok-copy"><p class="eyebrow">Bring your own key</p><h2>Your imagination.<br /><em>Your bill.</em></h2><p>On the hosted service, your OpenRouter key is encrypted at rest and opened only while your own generation job runs. It never comes back to the browser or enters a generated artifact.</p><ul><li>Usage stays visible in your OpenRouter account</li><li>No platform markup on model calls</li><li>Remove or replace the key whenever you want</li></ul><a href={data.marketing.allowSignUp ? '/auth/sign-up' : '/auth/sign-in'}>Connect your key <span>→</span></a></div>
    </section>

    <section class="open-section" id="open-source">
      <div><p class="eyebrow">Run the whole studio yourself</p><h2>Open source,<br /><em>from shelf to scene.</em></h2></div>
      <div><p>Use the deterministic mock in minutes, share one OpenRouter key across a trusted self-host, or keep inference local on Apple Silicon. Your database, object storage, queue, and provider policy remain explicit.</p><div class="terminal-card"><div><i></i><i></i><i></i><span>storyloom-studio</span></div><code><b>$</b> cp .env.example .env<br /><b>$</b> pnpm install && pnpm db:migrate<br /><b>$</b> pnpm dev</code></div><a class="open-link" href="https://github.com/epavanello/storyloom-studio" target="_blank" rel="noreferrer">View the repository <span>↗</span></a></div>
    </section>

    <section class="final-cta"><p class="eyebrow">The next chapter is yours</p><h2>Don’t just read it.<br /><em>Enter it.</em></h2><p>Start with your own OpenRouter key, or take the whole studio home.</p><div class="hero-actions"><a class="hero-primary" href={data.marketing.allowSignUp ? '/auth/sign-up' : '/auth/sign-in'}>{data.marketing.allowSignUp ? 'Create your studio' : 'Sign in'} <span>→</span></a><a class="hero-secondary" href="https://github.com/epavanello/storyloom-studio" target="_blank" rel="noreferrer">Self-host Storyloom ↗</a></div></section>

    <footer class="marketing-footer"><a class="brand" href="/"><span class="brand-mark">S</span><span>Storyloom</span></a><p>Open-source audiovisual storytelling, one chapter at a time.</p><nav><a href="/llms.txt">llms.txt</a><a href="/sitemap.xml">Sitemap</a><a href="https://github.com/epavanello/storyloom-studio" target="_blank" rel="noreferrer">GitHub ↗</a></nav></footer>
  </main>
{/if}

<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { signOut } from '$lib/auth-client';
  let { data, form } = $props();
  let uploading = $state(false);
  let generating = $state(false);
  let creationMode = $state<'generate' | 'upload'>('generate');
</script>

<svelte:head>
  <title>Storyloom Studio</title>
  <meta name="description" content="Turn books into synchronized audiovisual stories." />
</svelte:head>

<main class="landing-shell">
  <header class="brand-bar">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <nav class="account-nav">
      <a href="/jobs">Jobs</a>
      <a href="/settings">Settings</a>
      {#if data.user}<span class="account-email">{data.user.email}</span>{/if}
      <button class="text-button" onclick={() => signOut().then(() => goto('/auth/sign-in'))}>Sign out</button>
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

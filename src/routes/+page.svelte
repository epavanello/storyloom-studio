<script lang="ts">
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  let uploading = $state(false);
</script>

<svelte:head>
  <title>Storyloom Studio</title>
  <meta name="description" content="Turn books into synchronized audiovisual stories." />
</svelte:head>

<main class="landing-shell">
  <header class="brand-bar">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <span class="local-pill"><i></i> Local-first studio</span>
  </header>

  <section class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Books, staged in time</p>
      <h1>Listen to the page.<br /><em>See the story.</em></h1>
      <p class="lede">A private, local-first studio that turns a book into expressive narration and character-consistent scenes—one chapter at a time.</p>
      <div class="trust-row"><span>EPUB</span><span>PDF</span><span>TXT</span><span>On-demand generation</span></div>
    </div>

    <div class="import-card">
      <div class="card-heading"><span>New story</span><small>STEP 01</small></div>
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
      <div class="or-divider"><span>or</span></div>
      <form method="POST" action="?/demo"><button class="text-button">Open the built-in demo story</button></form>
    </div>
  </section>

  {#if data.books.length}
    <section class="library-section">
      <div class="section-title"><div><p class="eyebrow">Your shelf</p><h2>Continue listening</h2></div><span>{data.books.length} {data.books.length === 1 ? 'book' : 'books'}</span></div>
      <div class="book-grid">
        {#each data.books as book, index}
          <a class="book-card" href={`/books/${book.id}`}>
            <div class="mini-cover cover-{index % 4}"><span>{book.title.slice(0, 1)}</span><small>{book.chapters.length} CHAPTERS</small></div>
            <div><strong>{book.title}</strong><span>{book.registryStatus === 'ready' ? `${book.characters.length} characters ready` : 'Ready to prepare'}</span></div>
            <b>→</b>
          </a>
        {/each}
      </div>
    </section>
  {/if}
</main>


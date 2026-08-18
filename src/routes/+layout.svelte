<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  let { children } = $props();
</script>

<svelte:head>
  <meta name="robots" content={page.url.pathname === '/' ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : 'noindex, nofollow'} />
</svelte:head>

{@render children()}

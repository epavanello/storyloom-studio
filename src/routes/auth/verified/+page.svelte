<script lang="ts">
  let { data } = $props();
  const expired = $derived(data.verificationError === 'TOKEN_EXPIRED');
</script>

<svelte:head><title>Email verification · Storyloom</title></svelte:head>

<main class="auth-shell">
  <div class="auth-card auth-status-card">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <div class="auth-symbol" aria-hidden="true">!</div>
    <h1>{data.verificationError ? 'That link didn’t work' : 'Email verified'}</h1>
    {#if data.verificationError}
      <p class="auth-lede">{expired ? 'The verification link has expired.' : 'The verification link is invalid or has already been used.'} Sign in again to receive a fresh link.</p>
      <a class="primary-button auth-link-button" href={`/auth/sign-in?next=${encodeURIComponent(data.next)}`}>Return to sign in <span>→</span></a>
    {:else}
      <p class="form-success">Your email is verified. You can now sign in to Storyloom.</p>
      <a class="primary-button auth-link-button" href={`/auth/sign-in?next=${encodeURIComponent(data.next)}`}>Continue <span>→</span></a>
    {/if}
  </div>
</main>

<script lang="ts">
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';

  let password = $state('');
  let confirmation = $state('');
  let busy = $state(false);
  let complete = $state(false);
  let message = $state('');
  const token = $derived(page.url.searchParams.get('token') ?? '');
  const invalid = $derived(Boolean(page.url.searchParams.get('error')) || !token);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (password.length < 10) {
      message = 'Use at least 10 characters.';
      return;
    }
    if (password !== confirmation) {
      message = 'The passwords do not match.';
      return;
    }
    busy = true;
    message = '';
    const result = await authClient.resetPassword({ newPassword: password, token });
    busy = false;
    if (result.error) {
      message = result.error.message ?? 'This reset link is invalid or expired.';
      return;
    }
    complete = true;
  }
</script>

<svelte:head>
  <title>Choose a new password · Storyloom</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="auth-shell">
  <div class="auth-card">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <h1>Choose a new password</h1>
    {#if complete}
      <p class="form-success">Your password has been changed and your other sessions were signed out.</p>
      <a class="primary-button auth-link-button" href="/auth/sign-in">Sign in <span>→</span></a>
    {:else if invalid}
      <p class="form-error">This reset link is invalid or has expired.</p>
      <a class="secondary-button auth-link-button" href="/auth/forgot-password">Request another link</a>
    {:else}
      <p class="auth-lede">Use at least 10 characters. Resetting your password signs out every existing session.</p>
      <form onsubmit={submit}>
        <label>New password<input type="password" bind:value={password} autocomplete="new-password" minlength="10" required /></label>
        <label>Confirm new password<input type="password" bind:value={confirmation} autocomplete="new-password" minlength="10" required /></label>
        {#if message}<p class="form-error">{message}</p>{/if}
        <button class="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}<span>→</span></button>
      </form>
    {/if}
  </div>
</main>

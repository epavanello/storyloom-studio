<script lang="ts">
  import { authClient } from '$lib/auth-client';

  let { data } = $props();
  let email = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let message = $state('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    message = '';
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/auth/reset-password`
    });
    busy = false;
    if (result.error) {
      message = result.error.message ?? 'The reset email could not be sent.';
      return;
    }
    // The same response is shown for known and unknown addresses to prevent account probing.
    sent = true;
  }
</script>

<svelte:head><title>Reset your password · Storyloom</title></svelte:head>

<main class="auth-shell">
  <div class="auth-card">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <h1>Forgot your password?</h1>
    <p class="auth-lede">Enter your account email. If it exists, we’ll send a one-time reset link.</p>
    {#if !data.mailEnabled}
      <p class="form-error">Account recovery is not configured on this deployment. Ask its operator to enable Resend.</p>
    {:else if sent}
      <p class="form-success">Check your inbox. If an account exists for that address, its reset link is on the way.</p>
    {:else}
      <form onsubmit={submit}>
        <label>Email<input type="email" bind:value={email} autocomplete="email" required /></label>
        {#if message}<p class="form-error">{message}</p>{/if}
        <button class="primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}<span>→</span></button>
      </form>
    {/if}
    <p class="auth-switch"><a href="/auth/sign-in">Back to sign in</a></p>
  </div>
</main>

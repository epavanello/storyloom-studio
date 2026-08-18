<script lang="ts">
  import { goto } from '$app/navigation';
  import { signIn } from '$lib/auth-client';

  let { data } = $props();
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let message = $state('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    message = '';
    const result = await signIn.email({
      email,
      password,
      ...(data.requireEmailVerification
        ? { callbackURL: `/auth/verified?next=${encodeURIComponent(data.next)}` }
        : {})
    });
    busy = false;
    if (result.error) {
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        await goto(`/auth/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(data.next)}&sent=1`);
        return;
      }
      message = result.error.message ?? 'Those credentials were not accepted.';
      return;
    }
    await goto(data.next, { invalidateAll: true });
  }

  async function social(provider: 'github' | 'google') {
    busy = true;
    message = '';
    const result = await signIn.social({ provider, callbackURL: data.next });
    if (result?.error) {
      busy = false;
      message = result.error.message ?? `${provider} sign-in failed.`;
    }
  }
</script>

<svelte:head><title>Sign in · Storyloom</title></svelte:head>

<main class="auth-shell">
  <div class="auth-card">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <h1>Welcome back</h1>
    <p class="auth-lede">Your books, characters and renders are private to your account.</p>

    <form onsubmit={submit}>
      <label>Email<input type="email" bind:value={email} autocomplete="email" required /></label>
      <label>Password<input type="password" bind:value={password} autocomplete="current-password" required /></label>
      {#if data.mailEnabled}<a class="auth-inline-link" href="/auth/forgot-password">Forgot your password?</a>{/if}
      {#if message}<p class="form-error">{message}</p>{/if}
      <button class="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<span>→</span></button>
    </form>

    {#if data.providers.github || data.providers.google}
      <div class="or-divider"><span>or</span></div>
      <div class="social-row">
        {#if data.providers.github}<button class="secondary-button" onclick={() => social('github')} disabled={busy}>Continue with GitHub</button>{/if}
        {#if data.providers.google}<button class="secondary-button" onclick={() => social('google')} disabled={busy}>Continue with Google</button>{/if}
      </div>
    {/if}

    {#if data.allowSignUp}
      <p class="auth-switch">New here? <a href={`/auth/sign-up?next=${encodeURIComponent(data.next)}`}>Create an account</a></p>
    {:else}
      <p class="auth-switch">Registration is closed on this deployment.</p>
    {/if}
  </div>
</main>

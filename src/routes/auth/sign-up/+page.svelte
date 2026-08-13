<script lang="ts">
  import { goto } from '$app/navigation';
  import { signUp } from '$lib/auth-client';

  let { data } = $props();
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let message = $state('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (password.length < 10) {
      message = 'Use at least 10 characters.';
      return;
    }
    busy = true;
    message = '';
    const result = await signUp.email({ name: name || email.split('@')[0], email, password });
    busy = false;
    if (result.error) {
      message = result.error.message ?? 'The account could not be created.';
      return;
    }
    await goto(data.next, { invalidateAll: true });
  }
</script>

<svelte:head><title>Create an account · Storyloom</title></svelte:head>

<main class="auth-shell">
  <div class="auth-card">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <h1>Create your studio</h1>
    <p class="auth-lede">Your books, characters and renders stay private to your account.</p>

    {#if data.allowSignUp}
      <form onsubmit={submit}>
        <label>Name<input type="text" bind:value={name} autocomplete="name" placeholder="Optional" /></label>
        <label>Email<input type="email" bind:value={email} autocomplete="email" required /></label>
        <label>Password<input type="password" bind:value={password} autocomplete="new-password" minlength="10" required /><small>At least 10 characters.</small></label>
        {#if message}<p class="form-error">{message}</p>{/if}
        <button class="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create account'}<span>→</span></button>
      </form>
    {:else}
      <p class="form-error">Registration is closed on this deployment.</p>
    {/if}

    <p class="auth-switch">Already have an account? <a href={`/auth/sign-in?next=${encodeURIComponent(data.next)}`}>Sign in</a></p>
  </div>
</main>

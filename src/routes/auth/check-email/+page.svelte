<script lang="ts">
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';

  let { data } = $props();
  let busy = $state(false);
  let sent = $state(page.url.searchParams.get('sent') === '1');
  let message = $state('');
  const email = $derived(page.url.searchParams.get('email') ?? '');
  const requestedNext = $derived(page.url.searchParams.get('next'));
  const next = $derived(requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/');

  async function resend() {
    if (!email) return;
    busy = true;
    message = '';
    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: `/auth/verified?next=${encodeURIComponent(next)}`
    });
    busy = false;
    if (result.error) {
      message = result.error.message ?? 'The verification email could not be sent.';
      return;
    }
    sent = true;
  }
</script>

<svelte:head><title>Verify your email · Storyloom</title></svelte:head>

<main class="auth-shell">
  <div class="auth-card auth-status-card">
    <a class="brand" href="/" aria-label="Storyloom home"><span class="brand-mark">S</span><span>Storyloom</span></a>
    <div class="auth-symbol" aria-hidden="true">✉</div>
    <h1>Check your inbox</h1>
    <p class="auth-lede">We sent a verification link{email ? ` to ${email}` : ''}. Open it to activate your account and enter the studio.</p>
    {#if !data.mailEnabled}<p class="form-error">Transactional email is not configured on this deployment. Ask its operator to enable Resend.</p>{/if}
    {#if sent}<p class="form-success">A fresh verification link has been sent.</p>{/if}
    {#if message}<p class="form-error">{message}</p>{/if}
    {#if email && data.mailEnabled}<button class="secondary-button auth-wide" onclick={resend} disabled={busy}>{busy ? 'Sending…' : 'Resend verification email'}</button>{/if}
    <p class="auth-switch"><a href="/auth/sign-in">Back to sign in</a></p>
  </div>
</main>

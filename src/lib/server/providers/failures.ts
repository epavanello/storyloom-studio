/**
 * Turns a provider transport failure into something the person who started the job can act
 * on. A raw `403 Forbidden: {"error":{"message":"Key limit exceeded (monthly limit)…` is
 * accurate and useless: it does not say whose limit, or that the work already done is
 * still resumable. Anything unrecognised is passed through untouched, because an unknown
 * failure is better read verbatim than paraphrased.
 */
export function describeGenerationFailure(error: unknown) {
  // A thrown non-Error carries no dependable message; there is nothing to pass through.
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/key limit exceeded|monthly limit|quota/iu.test(message)) {
    return 'The OpenRouter key reached its spending limit, so the provider refused the request. Raise or reset the limit on the key, then resume this job: everything already generated is reused.';
  }
  if (/insufficient credit|402\b|requires more credits/iu.test(message)) {
    return 'The OpenRouter account is out of credits. Top it up, then resume this job: everything already generated is reused.';
  }
  if (/no auth credentials|invalid api key|user not found|^401\b/iu.test(message)) {
    return 'The OpenRouter key was rejected. Check the key under Settings, then resume this job: everything already generated is reused.';
  }
  if (/^429\b|rate limit/iu.test(message)) {
    return 'The provider rate-limited this account. Wait a moment, then resume this job: everything already generated is reused.';
  }
  return message || 'Generation failed';
}

/**
 * Whether one passage is worth trying again, as opposed to a failure that will repeat
 * identically. A provider that answered 200 and then produced an empty audio stream, a
 * gateway hiccup, a rate limit, or a timeout are transient; a rejected key or an exhausted
 * limit is not, and retrying it only makes the job slower to report the real problem.
 */
export function isRetryableProviderFailure(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/^(401|402|403|404|400)\b/u.test(message)) return false;
  if (/key limit exceeded|insufficient credit|invalid api key|no auth credentials/iu.test(message)) return false;
  return /^(408|409|425|429|5\d\d)\b/u.test(message)
    || /empty audio stream|no audio|returned no image|timed? ?out|timeout|aborted|socket hang up|ECONNRESET|EPIPE|fetch failed/iu.test(message);
}

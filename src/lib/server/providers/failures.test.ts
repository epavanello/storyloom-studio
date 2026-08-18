import { describe, expect, it } from 'vitest';
import { describeGenerationFailure } from './failures';

describe('provider failure messages', () => {
  it('explains an exhausted OpenRouter key and says the finished work is reused', () => {
    const message = describeGenerationFailure(new Error('403 Forbidden: {"error":{"message":"Key limit exceeded (monthly limit). Manage it using https://openrouter.ai/…","code":403}}'));
    expect(message).toContain('spending limit');
    expect(message).toContain('resume this job');
  });

  it('tells missing credits and a rejected key apart', () => {
    expect(describeGenerationFailure(new Error('402 Payment Required: Insufficient credits'))).toContain('out of credits');
    expect(describeGenerationFailure(new Error('401 Unauthorized: No auth credentials found'))).toContain('key was rejected');
    expect(describeGenerationFailure(new Error('429 Too Many Requests'))).toContain('rate-limited');
  });

  it('passes an unrecognised failure through verbatim', () => {
    expect(describeGenerationFailure(new Error('Chapter not found'))).toBe('Chapter not found');
    expect(describeGenerationFailure(undefined)).toBe('Generation failed');
  });
});

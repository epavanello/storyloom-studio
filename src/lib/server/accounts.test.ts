import { describe, expect, it } from 'vitest';
import { normalizeOpenRouterKey } from './accounts';

describe('OpenRouter credential input', () => {
  it('accepts and trims a plausible OpenRouter key', () => {
    expect(normalizeOpenRouterKey('  sk-or-v1-abcdefghijklmnopqrstuvwxyz  ')).toBe('sk-or-v1-abcdefghijklmnopqrstuvwxyz');
  });

  it('rejects empty, malformed, and non-OpenRouter secrets', () => {
    expect(() => normalizeOpenRouterKey('')).toThrow(/valid OpenRouter/);
    expect(() => normalizeOpenRouterKey('sk-some-other-provider')).toThrow(/valid OpenRouter/);
    expect(() => normalizeOpenRouterKey('sk-or-short')).toThrow(/valid OpenRouter/);
  });
});

import { describe, expect, it } from 'vitest';
import { selectOpenRouterKey } from './context';

describe('OpenRouter credential ownership', () => {
  it('never falls back to the operator key in account BYOK mode', () => {
    expect(selectOpenRouterKey('account', null, 'operator-key')).toBe('');
    expect(selectOpenRouterKey('account', 'account-key', 'operator-key')).toBe('account-key');
  });

  it('uses only the operator key in shared self-host mode', () => {
    expect(selectOpenRouterKey('shared', 'account-key', 'operator-key')).toBe('operator-key');
    expect(selectOpenRouterKey('shared', 'account-key', '')).toBe('');
  });
});

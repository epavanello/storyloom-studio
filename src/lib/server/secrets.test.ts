import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSecret, sealSecret, secretHint } from './secrets';

const KEY = 'test-encryption-key-that-is-long-enough-000';

describe('provider credential sealing', () => {
  const previous = process.env.STORYLOOM_ENCRYPTION_KEY;
  beforeAll(() => { process.env.STORYLOOM_ENCRYPTION_KEY = KEY; });
  afterAll(() => { process.env.STORYLOOM_ENCRYPTION_KEY = previous; });

  it('round-trips a key without storing it in the clear', () => {
    const sealed = sealSecret('sk-or-v1-abcdef0123456789');
    expect(sealed.ciphertext).not.toContain('sk-or');
    expect(openSecret(sealed)).toBe('sk-or-v1-abcdef0123456789');
  });

  it('produces a different ciphertext each time, so equal keys are not linkable', () => {
    expect(sealSecret('same-key-value').ciphertext).not.toBe(sealSecret('same-key-value').ciphertext);
  });

  it('shows only a tail in the hint', () => {
    expect(secretHint('sk-or-v1-abcdef0123456789')).toBe('••••6789');
    expect(secretHint('ab')).toBe('••••');
  });

  it('fails closed when the ciphertext or tag was tampered with', () => {
    const sealed = sealSecret('sk-or-v1-abcdef0123456789');
    expect(() => openSecret({ ...sealed, authTag: Buffer.alloc(16).toString('base64') })).toThrow();
  });

  it('cannot be opened with a different deployment key', () => {
    const sealed = sealSecret('sk-or-v1-abcdef0123456789');
    process.env.STORYLOOM_ENCRYPTION_KEY = 'a-completely-different-key-also-long-1234';
    expect(() => openSecret(sealed)).toThrow();
    process.env.STORYLOOM_ENCRYPTION_KEY = KEY;
  });

  it('refuses to run without a configured key', () => {
    process.env.STORYLOOM_ENCRYPTION_KEY = '';
    expect(() => sealSecret('anything')).toThrow(/STORYLOOM_ENCRYPTION_KEY/);
    process.env.STORYLOOM_ENCRYPTION_KEY = KEY;
  });
});

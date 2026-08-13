import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config';

export type SealedSecret = { ciphertext: string; iv: string; authTag: string; hint: string };

const ALGORITHM = 'aes-256-gcm';
// A fixed salt is acceptable here: the input is a high-entropy deployment secret, not a
// user password, and a per-record salt would have to be stored next to the ciphertext.
const SALT = 'storyloom-studio.credential-encryption.v1';

const cacheKey = Symbol.for('storyloom.encryption-key');
const globalCache = globalThis as typeof globalThis & { [cacheKey]?: { source: string; key: Buffer } };

function encryptionKey() {
  const source = getConfig().encryptionKey;
  if (!source) {
    throw new Error('STORYLOOM_ENCRYPTION_KEY is not set. Provider keys cannot be stored without it. Generate one with `openssl rand -base64 32`.');
  }
  if (source.length < 32) {
    throw new Error('STORYLOOM_ENCRYPTION_KEY must be at least 32 characters. Generate one with `openssl rand -base64 32`.');
  }
  const cached = globalCache[cacheKey];
  if (cached && cached.source === source) return cached.key;
  const key = scryptSync(source, SALT, 32);
  globalCache[cacheKey] = { source, key };
  return key;
}

/** A non-reversible tail used only so the UI can show which key is stored. */
export function secretHint(value: string) {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

export function sealSecret(plaintext: string): SealedSecret {
  if (!plaintext) throw new Error('Refusing to store an empty secret');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    hint: secretHint(plaintext)
  };
}

export function openSecret(sealed: Pick<SealedSecret, 'ciphertext' | 'iv' | 'authTag'>) {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Constant-time comparison for runner tokens and similar bearer values. */
export function secretEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactKey, artifactUrl, assertSafeKey, bookIdFromKey, getStorage, keyFromArtifactUrl } from './index';

describe('artifact keys', () => {
  it('derives a book-scoped key and a matching application URL', () => {
    const key = artifactKey('observatory-1a2b3c4', 'audio/chapter-1-u-1.wav');
    expect(key).toBe('books/observatory-1a2b3c4/audio/chapter-1-u-1.wav');
    expect(bookIdFromKey(key)).toBe('observatory-1a2b3c4');
    expect(keyFromArtifactUrl(artifactUrl(key))).toBe(key);
  });

  it('rejects traversal, absolute and empty segments before any driver sees them', () => {
    expect(() => assertSafeKey('books/a/../../etc/passwd')).toThrow();
    expect(() => assertSafeKey('/etc/passwd')).toThrow();
    expect(() => assertSafeKey('books//audio.wav')).toThrow();
    expect(() => assertSafeKey('')).toThrow();
    expect(() => artifactKey('book', '../../escape.wav')).toThrow();
  });

  it('does not treat a key outside the book namespace as owned by any book', () => {
    expect(bookIdFromKey('secrets/keys.json')).toBeNull();
    expect(keyFromArtifactUrl('/api/other/books/x/a.wav')).toBeNull();
  });
});

describe('filesystem storage driver', () => {
  let directory: string;
  const previous = process.env.STORYLOOM_DATA_DIR;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'storyloom-storage-'));
    process.env.STORYLOOM_DATA_DIR = directory;
    process.env.STORAGE_DRIVER = 'fs';
  });

  afterAll(async () => {
    process.env.STORYLOOM_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });

  it('round-trips bytes through a key', async () => {
    const storage = getStorage();
    const key = artifactKey('book-1', 'audio/one.wav');
    await storage.put(key, new Uint8Array([1, 2, 3, 4]), 'audio/wav');
    expect([...(await storage.get(key))]).toEqual([1, 2, 3, 4]);
    // No direct URL: the application streams these bytes itself.
    expect(await storage.signedUrl(key)).toBeNull();
  });

  it('removes every object belonging to a deleted book', async () => {
    const storage = getStorage();
    await storage.put(artifactKey('book-2', 'audio/one.wav'), new Uint8Array([1]), 'audio/wav');
    await storage.put(artifactKey('book-2', 'scenes/one.png'), new Uint8Array([2]), 'image/png');
    await storage.removePrefix('books/book-2');
    await expect(storage.get(artifactKey('book-2', 'audio/one.wav'))).rejects.toThrow();
  });

  it('refuses to read outside its root', async () => {
    await expect(getStorage().get('books/../../../etc/passwd')).rejects.toThrow();
  });
});

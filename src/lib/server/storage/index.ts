import { getConfig } from '../config';
import { createFilesystemStorage } from './filesystem';
import { createS3Storage } from './s3';

export type ObjectStorage = {
  readonly driver: 'fs' | 's3';
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  /** Backed by its own ArrayBuffer so the bytes can go straight into a Blob or Response. */
  get(key: string): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * A URL the browser can fetch directly, or null when the driver has no such URL and
   * the caller must stream the bytes itself.
   */
  signedUrl(key: string): Promise<string | null>;
  /** Deletes every object under a prefix. Used when a user deletes a book. */
  removePrefix(prefix: string): Promise<void>;
};

const stateKey = Symbol.for('storyloom.object-storage');
const globalState = globalThis as typeof globalThis & { [stateKey]?: { signature: string; storage: ObjectStorage } };

export function getStorage(): ObjectStorage {
  const { storage } = getConfig();
  const signature = JSON.stringify(storage);
  const existing = globalState[stateKey];
  if (existing && existing.signature === signature) return existing.storage;
  const created = storage.driver === 's3' ? createS3Storage(storage) : createFilesystemStorage(storage);
  globalState[stateKey] = { signature, storage: created };
  return created;
}

/** Rejects traversal and absolute segments before a key ever reaches a driver. */
export function assertSafeKey(key: string) {
  const segments = key.split('/');
  if (!key || key.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return key;
}

export function bookPrefix(bookId: string) {
  return `books/${assertSafeKey(bookId)}`;
}

/** Every artifact key starts with its book, which is how ownership is checked on read. */
export function artifactKey(bookId: string, relativePath: string) {
  return assertSafeKey(`${bookPrefix(bookId)}/${relativePath.replace(/^\/+/, '')}`);
}

export function bookIdFromKey(key: string) {
  const match = /^books\/([^/]+)\//.exec(key);
  return match ? match[1] : null;
}

/** The access-controlled application URL for an artifact key. */
export function artifactUrl(key: string) {
  return `/api/artifacts/${assertSafeKey(key).split('/').map(encodeURIComponent).join('/')}`;
}

export function keyFromArtifactUrl(path: string) {
  const prefix = '/api/artifacts/';
  if (!path.startsWith(prefix)) return null;
  return assertSafeKey(path.slice(prefix.length).split('/').map(decodeURIComponent).join('/'));
}

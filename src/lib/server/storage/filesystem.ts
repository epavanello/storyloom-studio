import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AppConfig } from '../config';
import { assertSafeKey, type ObjectStorage } from './index';

/**
 * Development and self-hosted single-machine driver. It keeps the same key space as
 * the S3 driver so a deployment can switch between them without rewriting artifacts.
 */
export function createFilesystemStorage(config: AppConfig['storage']): ObjectStorage {
  const root = resolve(config.dataDir, 'objects');
  const absolute = (key: string) => {
    const candidate = resolve(root, assertSafeKey(key));
    if (candidate !== root && !candidate.startsWith(`${root}/`)) throw new Error(`Unsafe storage key: ${key}`);
    return candidate;
  };

  return {
    driver: 'fs',
    async put(key, bytes) {
      const path = absolute(key);
      await mkdir(dirname(path), { recursive: true });
      // Written to a sibling first so a reader never observes a half-written artifact.
      const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, path);
    },
    async get(key) {
      return new Uint8Array(await readFile(absolute(key)));
    },
    async signedUrl() {
      return null;
    },
    async removePrefix(prefix) {
      await rm(join(root, assertSafeKey(prefix)), { recursive: true, force: true });
    }
  };
}

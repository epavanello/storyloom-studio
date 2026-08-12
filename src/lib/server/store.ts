import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import type { z } from 'zod';
import { BookManifestSchema, GenerationJobSchema, RenderedChapterSchema, type ArtifactRef, type BookManifest, type GenerationJob, type RenderedChapter } from '$lib/core/schemas';
import { getConfig } from './config';

const root = () => resolve(getConfig().dataDir);

export function bookDir(bookId: string) {
  return join(root(), 'books', safePart(bookId));
}

export function safePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

export async function writeJson<T>(path: string, schema: z.ZodType<T>, value: T) {
  const parsed = schema.parse(value);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, JSON.stringify(parsed, null, 2), 'utf8');
  await rename(temporary, path);
}

export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function saveManifest(manifest: BookManifest) {
  await writeJson(join(bookDir(manifest.id), 'book.json'), BookManifestSchema, manifest);
}

export async function getManifest(bookId: string) {
  return readJson(join(bookDir(bookId), 'book.json'), BookManifestSchema);
}

export async function listBooks() {
  const booksRoot = join(root(), 'books');
  await mkdir(booksRoot, { recursive: true });
  const entries = await readdir(booksRoot, { withFileTypes: true });
  const books: BookManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      books.push(await getManifest(entry.name));
    } catch {
      // Ignore incomplete imports.
    }
  }
  return books.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveRenderedChapter(bookId: string, rendered: RenderedChapter) {
  await writeJson(join(bookDir(bookId), 'rendered', `${safePart(rendered.chapterId)}.json`), RenderedChapterSchema, rendered);
}

export async function getRenderedChapter(bookId: string, chapterId: string) {
  try {
    return await readJson(join(bookDir(bookId), 'rendered', `${safePart(chapterId)}.json`), RenderedChapterSchema);
  } catch {
    return null;
  }
}

export async function saveGenerationJob(job: GenerationJob) {
  await writeJson(join(bookDir(job.bookId), 'jobs', `${safePart(job.id)}.json`), GenerationJobSchema, job);
}

export async function getGenerationJob(bookId: string, jobId: string) {
  return readJson(join(bookDir(bookId), 'jobs', `${safePart(jobId)}.json`), GenerationJobSchema);
}

export async function listGenerationJobs(bookId: string) {
  const jobsDir = join(bookDir(bookId), 'jobs');
  await mkdir(jobsDir, { recursive: true });
  const entries = await readdir(jobsDir, { withFileTypes: true });
  const jobs: GenerationJob[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      jobs.push(await readJson(join(jobsDir, entry.name), GenerationJobSchema));
    } catch {
      // Ignore incompatible or manually damaged job records.
    }
  }
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveArtifact(bookId: string, relativePath: string, data: Uint8Array | string, meta: Omit<ArtifactRef, 'path' | 'createdAt'>): Promise<ArtifactRef> {
  const normalized = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolute = join(bookDir(bookId), 'artifacts', normalized);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, data);
  return {
    path: `/api/artifacts/${encodeURIComponent(bookId)}/${normalized.split(/[/\\]/).map(encodeURIComponent).join('/')}`,
    createdAt: new Date().toISOString(),
    ...meta
  };
}

export function resolveArtifact(bookId: string, artifactPath: string) {
  const base = join(bookDir(bookId), 'artifacts');
  const candidate = resolve(base, artifactPath);
  if (!candidate.startsWith(`${base}/`) && candidate !== base) throw new Error('Invalid artifact path');
  return candidate;
}

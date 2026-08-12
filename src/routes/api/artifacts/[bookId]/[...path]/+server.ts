import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveArtifact } from '$lib/server/store';

const contentType = (path: string) => path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : path.endsWith('.wav') ? 'audio/wav' : path.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const bytes = await readFile(resolveArtifact(params.bookId, params.path));
    return new Response(bytes, { headers: { 'content-type': contentType(params.path), 'cache-control': 'public, max-age=31536000, immutable' } });
  } catch { error(404, 'Artifact not found'); }
};


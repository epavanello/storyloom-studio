import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/session';
import { BookNotFoundError, savePlaybackProgress } from '$lib/server/store';

const CursorSchema = z.object({
  utteranceId: z.string().min(1),
  positionMs: z.number().nonnegative()
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const user = requireUser(locals);
  try {
    const cursor = CursorSchema.parse(await request.json());
    return json(await savePlaybackProgress(user.id, params.bookId, params.chapterId, cursor));
  } catch (cause) {
    if (cause instanceof BookNotFoundError) return json({ error: 'Book not found' }, { status: 404 });
    return json({ error: cause instanceof Error ? cause.message : 'Could not save listening position' }, { status: 400 });
  }
};

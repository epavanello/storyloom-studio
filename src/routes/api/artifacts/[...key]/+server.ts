import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/session';
import { assertSafeKey, bookIdFromKey, getStorage } from '$lib/server/storage/index';
import { assertBookOwner } from '$lib/server/store';

const contentType = (key: string) =>
  key.endsWith('.svg') ? 'image/svg+xml'
  : key.endsWith('.png') ? 'image/png'
  : key.endsWith('.jpg') ? 'image/jpeg'
  : key.endsWith('.webp') ? 'image/webp'
  : key.endsWith('.wav') ? 'audio/wav'
  : key.endsWith('.mp3') ? 'audio/mpeg'
  : 'application/octet-stream';

/**
 * Generated media is user data, so it is never served from a public bucket URL. The key
 * is scoped to a book, the book is checked against the session, and only then is a
 * short-lived signed URL handed out (or the bytes streamed, for the filesystem driver).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  let key: string;
  try {
    key = assertSafeKey(params.key);
  } catch {
    error(400, 'Invalid artifact key');
  }

  const bookId = bookIdFromKey(key);
  if (!bookId) error(400, 'Invalid artifact key');
  try {
    await assertBookOwner(user.id, bookId);
  } catch {
    // Deliberately indistinguishable from a missing artifact: an unauthorized caller
    // must not be able to probe which books exist.
    error(404, 'Artifact not found');
  }

  const storage = getStorage();
  try {
    const signed = await storage.signedUrl(key);
    if (signed) redirect(302, signed);
    const bytes = await storage.get(key);
    return new Response(bytes, {
      headers: {
        'content-type': contentType(key),
        // Artifacts are immutable versions, but they are private, so only the browser
        // that fetched them may keep a copy.
        'cache-control': 'private, max-age=31536000, immutable'
      }
    });
  } catch (cause) {
    if (cause instanceof Response) throw cause;
    error(404, 'Artifact not found');
  }
};

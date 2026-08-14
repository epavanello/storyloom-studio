import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signedUrl: vi.fn(),
  assertBookOwner: vi.fn()
}));

vi.mock('$lib/server/session', () => ({
  requireUser: () => ({ id: 'user-1' })
}));

vi.mock('$lib/server/store', () => ({
  assertBookOwner: mocks.assertBookOwner
}));

vi.mock('$lib/server/storage/index', () => ({
  assertSafeKey: (key: string) => key,
  bookIdFromKey: () => 'book-1',
  getStorage: () => ({ signedUrl: mocks.signedUrl })
}));

import { GET } from '../../routes/api/artifacts/[...key]/+server';

describe('GET /api/artifacts/[...key]', () => {
  it('preserves the signed S3 URL redirect instead of returning 404', async () => {
    mocks.signedUrl.mockResolvedValueOnce('https://bucket.example.test/signed-artifact');

    try {
      await GET({ params: { key: 'books/book-1/characters/nube.png' }, locals: {} } as any);
      throw new Error('Expected GET to redirect');
    } catch (cause) {
      expect(isRedirect(cause)).toBe(true);
      expect(cause).toMatchObject({ status: 302, location: 'https://bucket.example.test/signed-artifact' });
    }
  });
});

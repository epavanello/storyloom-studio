import { and, eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { providerCredentials } from './db/schema';
import { openSecret, sealSecret } from './secrets';

/** Providers a user can bring their own key for. */
export const credentialProviders = ['openrouter'] as const;
export type CredentialProvider = (typeof credentialProviders)[number];

export async function setProviderCredential(userId: string, provider: CredentialProvider, value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('The key is empty');
  const sealed = sealSecret(trimmed);
  const db = getDb();
  await db
    .insert(providerCredentials)
    .values({ userId, provider, ...sealed })
    .onConflictDoUpdate({
      target: [providerCredentials.userId, providerCredentials.provider],
      set: { ...sealed, updatedAt: new Date() }
    });
}

export async function deleteProviderCredential(userId: string, provider: CredentialProvider) {
  const db = getDb();
  await db.delete(providerCredentials).where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, provider)));
}

/** Plaintext key for job execution. Never call this from a route that renders to the browser. */
export async function getProviderCredential(userId: string, provider: CredentialProvider) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.provider, provider)))
    .limit(1);
  if (!row) return null;
  return openSecret(row);
}

/** Safe for the browser: says whether a key exists and shows only its last characters. */
export async function listCredentialHints(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ provider: providerCredentials.provider, hint: providerCredentials.hint, updatedAt: providerCredentials.updatedAt })
    .from(providerCredentials)
    .where(eq(providerCredentials.userId, userId));
  return rows.map((row) => ({ provider: row.provider, hint: row.hint, updatedAt: row.updatedAt.toISOString() }));
}

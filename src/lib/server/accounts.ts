import { and, eq } from 'drizzle-orm';
import { getDb } from './db/client';
import { account as authAccounts, providerCredentials } from './db/schema';
import { openSecret, sealSecret } from './secrets';

/** Providers a user can bring their own key for. */
export const credentialProviders = ['openrouter'] as const;
export type CredentialProvider = (typeof credentialProviders)[number];

export function normalizeOpenRouterKey(value: string) {
  const trimmed = value.trim();
  if (!/^sk-or-[A-Za-z0-9_-]{16,}$/.test(trimmed)) {
    throw new Error('Enter a valid OpenRouter API key beginning with sk-or-.');
  }
  return trimmed;
}

export async function setProviderCredential(userId: string, provider: CredentialProvider, value: string) {
  const trimmed = provider === 'openrouter' ? normalizeOpenRouterKey(value) : value.trim();
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

export async function hasPasswordCredential(userId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'credential')))
    .limit(1);
  return Boolean(row);
}

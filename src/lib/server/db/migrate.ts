/**
 * Applies the generated SQL migrations. Runs from the repository (`pnpm db:migrate`) and
 * from a deployment image alike, without needing drizzle-kit installed at runtime.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { loadEnvFile } from 'node:process';
import { getConfig, requireDatabaseUrl } from '../config';

// Vite loads `.env` for the web process, but this standalone CLI runs through tsx.
// Explicitly exported variables retain priority; a missing `.env` is handled by the
// actionable DATABASE_URL error below.
try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const client = createClient({
  url: requireDatabaseUrl(),
  authToken: getConfig().databaseAuthToken || undefined
});

try {
  await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  console.log('[db] migrations applied');
} finally {
  client.close();
}

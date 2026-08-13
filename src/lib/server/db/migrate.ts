/**
 * Applies the generated SQL migrations. Runs from the repository (`pnpm db:migrate`) and
 * from a deployment image alike, without needing drizzle-kit installed at runtime.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { getConfig, requireDatabaseUrl } from '../config';

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

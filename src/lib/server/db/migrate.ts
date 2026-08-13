/**
 * Applies the generated SQL migrations. Runs from the repository (`pnpm db:migrate`) and
 * from a deployment image alike, without needing drizzle-kit installed at runtime.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { requireDatabaseUrl } from '../config';

const sql = postgres(requireDatabaseUrl(), { max: 1, prepare: false, onnotice: () => {} });

try {
  await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
  console.log('[db] migrations applied');
} finally {
  await sql.end({ timeout: 5 });
}

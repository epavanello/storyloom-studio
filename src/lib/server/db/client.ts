import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { getConfig, requireDatabaseUrl } from '../config';
import { schema } from './schema';

type Database = ReturnType<typeof create>['db'];

const stateKey = Symbol.for('storyloom.database');
const globalState = globalThis as typeof globalThis & { [stateKey]?: { signature: string; db: Database; close: () => void } };

/**
 * One client for both shapes of deployment:
 *
 *   DATABASE_URL=file:./data/storyloom.db        a local SQLite file
 *   DATABASE_URL=libsql://<db>.turso.io          a hosted database, plus DATABASE_AUTH_TOKEN
 *
 * A `file:` URL only works when everything runs on one machine. A web tier and a
 * detached worker on different machines need the hosted form, because they cannot
 * share a file.
 */
function create(url: string, authToken: string) {
  const client = createClient({ url, authToken: authToken || undefined });
  return { client, db: drizzle(client, { schema }), close: () => client.close() };
}

export function getDb() {
  const url = requireDatabaseUrl();
  const { databaseAuthToken } = getConfig();
  const signature = `${url}::${databaseAuthToken}`;
  const existing = globalState[stateKey];
  if (existing && existing.signature === signature) return existing.db;
  const created = create(url, databaseAuthToken);
  globalState[stateKey] = { signature, db: created.db, close: created.close };
  return created.db;
}

/** Closes the client so a worker process can exit promptly. */
export async function closeDb() {
  const existing = globalState[stateKey];
  if (!existing) return;
  delete globalState[stateKey];
  existing.close();
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getConfig, requireDatabaseUrl } from '../config';
import { schema } from './schema';

type Database = ReturnType<typeof create>['db'];

const stateKey = Symbol.for('storyloom.database');
const globalState = globalThis as typeof globalThis & { [stateKey]?: { url: string; db: Database; sql: postgres.Sql } };

function create(url: string) {
  const sql = postgres(url, {
    // A serverless Postgres bills for compute time, so connections are kept few and
    // are dropped quickly when idle: nothing in Storyloom polls the database, and an
    // idle deployment should let the instance suspend.
    max: getConfig().worker.mode === 'external' ? 3 : 5,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 15,
    // Neon's pooled endpoint (and pgbouncer in general) cannot serve named prepared
    // statements across pooled connections.
    prepare: false,
    onnotice: () => {}
  });
  return { sql, db: drizzle(sql, { schema }) };
}

export function getDb() {
  const url = requireDatabaseUrl();
  const existing = globalState[stateKey];
  if (existing && existing.url === url) return existing.db;
  const created = create(url);
  globalState[stateKey] = { url, ...created };
  return created.db;
}

/** Closes the pool so a worker process can exit without waiting for idle sockets. */
export async function closeDb() {
  const existing = globalState[stateKey];
  if (!existing) return;
  delete globalState[stateKey];
  await existing.sql.end({ timeout: 5 });
}

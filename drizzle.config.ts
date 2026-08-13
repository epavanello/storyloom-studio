import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/storyloom.db',
    authToken: process.env.DATABASE_AUTH_TOKEN
  },
  casing: 'snake_case'
});

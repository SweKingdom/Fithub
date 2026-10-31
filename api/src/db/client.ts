import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }) });
}

/** Connects with `DATABASE_URL`. Fails with a plain message when it is not set. */
export function createDbFromEnv(env: NodeJS.ProcessEnv = process.env): Kysely<Database> {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set.');
  return createDb(url);
}

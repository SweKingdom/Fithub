import { sql, type Kysely } from 'kysely';
import { createDb } from '../../src/db/client.js';
import type { Database } from '../../src/db/schema.js';

export const TEST_DATABASE_URL_DEFAULT = 'postgres://fithub:fithub@localhost:5432/fithub_test';

export function getTestDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? TEST_DATABASE_URL_DEFAULT;
}

export function assertTestDatabase(url: string): void {
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('Refusing to run integration tests: DATABASE_URL is not a valid URL');
  }
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against non-test database "${name}"`);
  }
}

let testDb: Kysely<Database> | undefined;

export function getTestDb(): Kysely<Database> {
  if (!testDb) {
    const url = getTestDatabaseUrl();
    assertTestDatabase(url);
    testDb = createDb(url);
  }
  return testDb;
}

interface TableRow {
  tablename: string;
}

export async function resetDb(db: Kysely<Database>): Promise<void> {
  const { rows } = await sql<TableRow>`
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('kysely_migration', 'kysely_migration_lock')
  `.execute(db);
  if (rows.length === 0) {
    return;
  }
  const tables = sql.join(rows.map((row: TableRow) => sql.id(row.tablename)));
  await sql`truncate table ${tables} restart identity cascade`.execute(db);
}

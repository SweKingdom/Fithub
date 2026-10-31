import { createDb } from '../../src/db/client.js';
import { migrateToLatest } from '../../src/db/migrator.js';
import { assertTestDatabase } from './test-database.js';

/** Runs once before the integration tests: checks the database name, then migrates to the latest version. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) to the fithub_test database.');
  assertTestDatabase(url);
  const db = createDb(url);
  try {
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
}

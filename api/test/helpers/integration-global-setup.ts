import { createDb } from '../../src/db/client.js';
import { createMigrator } from '../../src/db/migrator.js';
import { assertTestDatabase, getTestDatabaseUrl } from './db.js';

export default async function setup(): Promise<void> {
  const url = getTestDatabaseUrl();
  assertTestDatabase(url);
  process.env.DATABASE_URL = url;

  const db = createDb(url);
  try {
    const { error, results } = await createMigrator(db).migrateToLatest();
    for (const result of results ?? []) {
      process.stdout.write(`Test database migration ${result.migrationName}: ${result.status}\n`);
    }
    if (error) {
      throw new Error('Migrating the test database failed', { cause: error });
    }
  } finally {
    await db.destroy();
  }
}

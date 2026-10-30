import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { createMigrator } from './migrator.js';

async function main(direction: string | undefined): Promise<void> {
  if (direction !== 'up' && direction !== 'down') {
    console.error('Usage: migrate.ts <up|down>');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    const migrator = createMigrator(db);
    const { error, results } =
      direction === 'up' ? await migrator.migrateToLatest() : await migrator.migrateDown();

    if (!results || results.length === 0) {
      console.log('No migrations to run');
    }
    for (const result of results ?? []) {
      console.log(`${result.migrationName}: ${result.status}`);
    }
    if (error) {
      console.error('Migration failed', error);
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

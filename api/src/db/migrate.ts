import { createDbFromEnv } from './client.js';
import { createMigrator, migrateToLatest } from './migrator.js';

/**
 * CLI: `npm run db:migrate` applies the pending migrations to `DATABASE_URL`;
 * `npm run db:migrate:down` reverts the most recently applied one.
 */
async function main(): Promise<number> {
  let db;
  try {
    db = createDbFromEnv();
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  try {
    if (process.argv.includes('--down')) {
      const { error, results } = await createMigrator(db).migrateDown();
      if (error) throw error instanceof Error ? error : new Error(String(error));
      const reverted = (results ?? []).map((result) => result.migrationName);
      console.log(reverted.length === 0 ? 'Nothing to revert.' : `Reverted: ${reverted.join(', ')}.`);
      return 0;
    }
    const applied = await migrateToLatest(db);
    console.log(applied.length === 0 ? 'Database is up to date.' : `Applied: ${applied.join(', ')}.`);
    return 0;
  } catch (error) {
    console.error(`Migration failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main();

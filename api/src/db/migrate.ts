import { createDbFromEnv } from './client.js';
import { migrateToLatest } from './migrator.js';

/** CLI: `npm run db:migrate`. Applies the pending migrations to `DATABASE_URL`. */
async function main(): Promise<number> {
  let db;
  try {
    db = createDbFromEnv();
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  try {
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

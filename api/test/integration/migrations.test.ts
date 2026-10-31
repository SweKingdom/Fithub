import { NO_MIGRATIONS } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createMigrator } from '../../src/db/migrator.js';
import { testDb } from '../helpers/db.js';

describe('Migrations (US-117, AC 7)', () => {
  const db = testDb();
  const migrator = createMigrator(db);

  afterAll(async () => {
    // Leave the shared test database fully migrated for the files that run after this one.
    await migrator.migrateToLatest();
  });

  async function tableExists(name: string): Promise<boolean> {
    const rows = await db
      .selectFrom('information_schema.tables' as never)
      .select('table_name' as never)
      .where('table_schema' as never, '=', 'public' as never)
      .where('table_name' as never, '=', name as never)
      .execute();
    return rows.length > 0;
  }

  it('AC 7: migrates down to zero without error and up again, recreating club', async () => {
    const down = await migrator.migrateTo(NO_MIGRATIONS);
    expect(down.error).toBeUndefined();
    expect(await tableExists('club')).toBe(false);

    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    expect(await tableExists('club')).toBe(true);
  });
});

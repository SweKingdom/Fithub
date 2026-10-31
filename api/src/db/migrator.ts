import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Migrator, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import type { Database } from './schema.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.(ts|js)$/;

/** Loads `api/migrations/NNNN_name.ts` files; file URLs keep dynamic import working on Windows too. */
const folderProvider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    for (const file of (await readdir(MIGRATIONS_DIR)).sort()) {
      const match = MIGRATION_FILE.exec(file);
      if (!match) continue;
      const module = (await import(pathToFileURL(join(MIGRATIONS_DIR, file)).href)) as Migration;
      migrations[match[1]] = { up: module.up, down: module.down };
    }
    return migrations;
  },
};

export function createMigrator(db: Kysely<Database>): Migrator {
  // Stories merge in any order (0020 exists before 0005), so a database that already ran a higher number
  // must still accept a lower one that it has not run yet.
  return new Migrator({ db, provider: folderProvider, allowUnorderedMigrations: true });
}

/** Applies every pending migration; returns the names that ran. Throws when one fails. */
export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const { error, results } = await createMigrator(db).migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((result) => result.status === 'Success').map((result) => result.migrationName);
}

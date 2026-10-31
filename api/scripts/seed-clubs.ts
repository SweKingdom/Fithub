import { parseArgs } from 'node:util';
import type { Kysely } from 'kysely';
import { createDbFromEnv } from '../src/db/client.js';
import type { Database } from '../src/db/schema.js';
import {
  ClubSeedError,
  formatClubSeedSummary,
  loadClubSeedFile,
  seedClubs,
} from '../src/modules/clubs/seed.js';

const USAGE = 'Usage: npm run db:seed:clubs -w api -- [--file <path>]';
const DEFAULT_FILE = 'seed/clubs.json';

/** Thin CLI: reads and validates the seed file, applies it in one transaction. Exit 0 = seeded, 1 = nothing written. */
async function main(): Promise<number> {
  let file: string;
  try {
    const { values } = parseArgs({ options: { file: { type: 'string' } }, strict: true });
    file = values.file ?? DEFAULT_FILE;
  } catch (error) {
    console.error(`${(error as Error).message}. ${USAGE}`);
    return 1;
  }

  let db: Kysely<Database> | undefined;
  try {
    const entries = loadClubSeedFile(file);
    db = createDbFromEnv();
    const result = await seedClubs(db, entries, (line) => console.log(line));
    console.log(formatClubSeedSummary(result));
    result.warnings.forEach((warning) => console.warn(warning));
    return 0;
  } catch (error) {
    if (error instanceof ClubSeedError) {
      error.problems.forEach((problem) => console.error(problem));
    } else {
      console.error(`The club seed failed and nothing was written: ${(error as Error).message}`);
    }
    return 1;
  } finally {
    await db?.destroy();
  }
}

process.exitCode = await main();

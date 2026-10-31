import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDbFromEnv } from '../src/db/client.js';
import { ClubSeedError, parseClubSeed, seedClubs } from '../src/modules/clubs/seed.js';

const USAGE = 'Usage: npm run db:seed:clubs -w api -- --file <path to clubs.json>';

/** Thin CLI: reads the file, calls the service, prints one line. Exit 0 = done, 1 = nothing changed. */
async function main(): Promise<number> {
  let file: string | undefined;
  try {
    ({
      values: { file },
    } = parseArgs({ options: { file: { type: 'string' } }, strict: true }));
  } catch (error) {
    console.error(`${(error as Error).message}. ${USAGE}`);
    return 1;
  }
  if (!file) {
    console.error(`--file is required. ${USAGE}`);
    return 1;
  }

  let clubs;
  try {
    clubs = parseClubSeed(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error instanceof ClubSeedError) {
      console.error(error.message);
    } else {
      console.error(`The club file could not be read as JSON: ${(error as Error).message}`);
    }
    return 1;
  }

  let db;
  try {
    db = createDbFromEnv();
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  try {
    console.log(`Seeded ${await seedClubs(db, clubs)} clubs.`);
    return 0;
  } catch (error) {
    console.error(`The command failed and nothing was changed: ${(error as Error).message}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main();

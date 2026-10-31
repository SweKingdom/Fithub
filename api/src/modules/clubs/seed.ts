import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../db/schema.js';

export interface ClubSeedEntry {
  code: string;
  name: string;
  timezone: string;
}

/** An operator mistake in the seed file. The message is one plain line for the command line. */
export class ClubSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClubSeedError';
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const clubSeedSchema = z
  .array(
    z.object({
      code: z
        .string()
        .trim()
        .min(1, 'code is required')
        .max(32, 'code must be at most 32 characters')
        .transform((code) => code.toUpperCase()),
      name: z.string().trim().min(1, 'name is required').max(200, 'name must be at most 200 characters'),
      timezone: z.string().trim().refine(isTimeZone, 'timezone must be an IANA time zone such as Europe/Stockholm'),
    }),
  )
  .min(1, 'the file must list at least one club');

/** Validates the parsed JSON of a seed file: `[{ "code", "name", "timezone" }, …]`, codes unique ignoring case. */
export function parseClubSeed(json: unknown): ClubSeedEntry[] {
  const result = clubSeedSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new ClubSeedError(`Invalid club file: ${where}${issue.message}.`);
  }
  const seen = new Set<string>();
  for (const club of result.data) {
    if (seen.has(club.code)) throw new ClubSeedError(`Invalid club file: code ${club.code} appears twice.`);
    seen.add(club.code);
  }
  return result.data;
}

/** Inserts the clubs, or updates name and time zone of the ones whose code exists. One statement, so all or nothing. */
export async function seedClubs(db: Kysely<Database>, clubs: ClubSeedEntry[]): Promise<number> {
  await db
    .insertInto('club')
    .values(clubs)
    .onConflict((conflict) =>
      conflict.column('code').doUpdateSet((eb) => ({ name: eb.ref('excluded.name'), timezone: eb.ref('excluded.timezone') })),
    )
    .execute();
  return clubs.length;
}

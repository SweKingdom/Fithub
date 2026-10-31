import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

export interface ClubRow {
  id: string;
  name: string;
  timezone: string;
}

/** All clubs, sorted by name. */
export function listClubs(db: Kysely<Database>): Promise<ClubRow[]> {
  return db.selectFrom('club').select(['id', 'name', 'timezone']).orderBy('name', 'asc').orderBy('id', 'asc').execute();
}

export function findClubById(db: Kysely<Database>, id: string): Promise<ClubRow | undefined> {
  return db.selectFrom('club').select(['id', 'name', 'timezone']).where('id', '=', id).executeTakeFirst();
}

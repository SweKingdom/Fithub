import type { Kysely } from 'kysely';
import type { ClubDatabase, ClubRow } from './db-types.js';

/** All clubs, sorted by name, then id. Other modules use these functions, never ad-hoc club queries. */
export function listClubs(db: Kysely<ClubDatabase>): Promise<ClubRow[]> {
  return db.selectFrom('club').selectAll().orderBy('name').orderBy('id').execute();
}

export function findClubById(db: Kysely<ClubDatabase>, id: string): Promise<ClubRow | undefined> {
  return db.selectFrom('club').selectAll().where('id', '=', id).executeTakeFirst();
}

export function findClubByCode(db: Kysely<ClubDatabase>, code: string): Promise<ClubRow | undefined> {
  return db.selectFrom('club').selectAll().where('code', '=', code).executeTakeFirst();
}

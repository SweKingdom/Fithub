import { sql, type Insertable, type Kysely, type Selectable } from 'kysely';
import type { AppUserTable, AuthDatabase } from './db-types.js';

type Db = Kysely<AuthDatabase>;

export type AppUserRow = Selectable<AppUserTable>;

/** Case-insensitive lookup; the unique index on `lower(email)` backs it. */
export function findUserByEmail(db: Db, email: string): Promise<AppUserRow | undefined> {
  return db
    .selectFrom('app_user')
    .selectAll()
    .where(sql<boolean>`lower(email) = lower(${email.trim()})`)
    .executeTakeFirst();
}

export function findUserById(db: Db, id: string): Promise<AppUserRow | undefined> {
  return db.selectFrom('app_user').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function insertUser(db: Db, user: Insertable<AppUserTable>): Promise<string> {
  const row = await db.insertInto('app_user').values(user).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

export async function updatePasswordHash(db: Db, userId: string, passwordHash: string, now: Date): Promise<void> {
  await db
    .updateTable('app_user')
    .set({ password_hash: passwordHash, updated_at: now })
    .where('id', '=', userId)
    .execute();
}

export async function findClubName(db: Db, clubId: string): Promise<string | null> {
  const row = await db.selectFrom('club').select('name').where('id', '=', clubId).executeTakeFirst();
  return row?.name ?? null;
}

export function findClubByCode(db: Db, code: string): Promise<{ id: string; name: string } | undefined> {
  return db.selectFrom('club').select(['id', 'name']).where('code', '=', code).executeTakeFirst();
}

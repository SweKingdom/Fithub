import { sql, type Kysely } from 'kysely';
import type { ImportDatabase } from './db-types.js';
import type { MemberPatch, MemberSnapshot, NewMemberRow, SnapshotUser } from './members.plan.js';

/** Advisory lock key shared by all imports (US-135, US-136) so they never run in parallel. */
export const IMPORT_LOCK_KEY = 735136;

const CHUNK_SIZE = 500;

type Db = Kysely<ImportDatabase>;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) out.push(items.slice(i, i + CHUNK_SIZE));
  return out;
}

/** Takes the transaction-scoped import lock; released at commit or rollback. */
export async function lockImports(trx: Db): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_KEY}::bigint)`.execute(trx);
}

export async function loadMemberSnapshot(
  db: Db,
): Promise<{ snapshot: MemberSnapshot; clubsByCode: Map<string, string> }> {
  const users = await db
    .selectFrom('app_user')
    .select([
      'id',
      sql<string>`lower(email)`.as('email'),
      'full_name',
      'role',
      'member_type',
      'club_id',
      'legacy_member_id',
    ])
    .execute();
  const aliasRows = await db.selectFrom('import_member_alias').select(['legacy_member_id', 'user_id']).execute();
  const clubs = await db.selectFrom('club').select(['id', 'code']).execute();

  const snapshot: MemberSnapshot = { usersByEmail: new Map(), usersById: new Map(), aliases: new Map() };
  for (const user of users) {
    const entry: SnapshotUser = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      memberType: user.member_type,
      clubId: user.club_id,
      legacyMemberId: user.legacy_member_id,
    };
    snapshot.usersByEmail.set(entry.email, entry);
    snapshot.usersById.set(entry.id, entry);
  }
  for (const alias of aliasRows) snapshot.aliases.set(alias.legacy_member_id, alias.user_id);

  return { snapshot, clubsByCode: new Map(clubs.map((club) => [club.code, club.id])) };
}

/** Multi-row inserts in chunks of 500. Returns `email → id` of the new members. */
export async function insertMembers(trx: Db, rows: NewMemberRow[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const chunk of chunks(rows)) {
    const inserted = await trx.insertInto('app_user').values(chunk).returning(['id', 'email']).execute();
    for (const row of inserted) ids.set(row.email, row.id);
  }
  return ids;
}

export async function updateMember(trx: Db, id: string, patch: MemberPatch, now: Date): Promise<void> {
  await trx
    .updateTable('app_user')
    .set({ ...patch, updated_at: now })
    .where('id', '=', id)
    .execute();
}

export async function insertAliases(
  trx: Db,
  rows: Array<{ legacy_member_id: string; user_id: string }>,
): Promise<void> {
  for (const chunk of chunks(rows)) {
    await trx.insertInto('import_member_alias').values(chunk).execute();
  }
}

import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '../helpers/db.js';
import { createClub } from '../helpers/factories.js';

describe('app_user constraints (US-118 AC 12)', () => {
  const db = testDb();
  let clubId: string;

  beforeAll(async () => {
    clubId = (await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' })).id;
  });

  const newEmail = () => `c-${randomUUID()}@example.com`;

  /** Raw insert, so the types cannot hide an invalid combination. */
  function insert(fields: { email?: string; role: string; memberType?: string | null; clubId?: string | null }) {
    return sql`
      INSERT INTO app_user (email, full_name, role, member_type, club_id)
      VALUES (${fields.email ?? newEmail()}, 'Test User', ${fields.role}, ${fields.memberType ?? null}, ${fields.clubId ?? null})
    `.execute(db);
  }

  it('accepts a member with a member type and no club', async () => {
    await expect(insert({ role: 'member', memberType: 'regular' })).resolves.toBeDefined();
  });

  it('accepts staff with a club and no member type', async () => {
    await expect(insert({ role: 'instructor', clubId })).resolves.toBeDefined();
    await expect(insert({ role: 'club_manager', clubId })).resolves.toBeDefined();
  });

  it('rejects a member without member_type', async () => {
    await expect(insert({ role: 'member' })).rejects.toThrow(/app_user_member_type_role_ck/);
  });

  it.each(['instructor', 'club_manager'])('rejects a %s without club_id', async (role) => {
    await expect(insert({ role })).rejects.toThrow(/app_user_staff_club_ck/);
  });

  it('rejects a staff user with member_type', async () => {
    await expect(insert({ role: 'instructor', clubId, memberType: 'regular' })).rejects.toThrow(
      /app_user_member_type_role_ck/,
    );
  });

  it('rejects an unknown role and an unknown member type', async () => {
    await expect(insert({ role: 'admin', clubId })).rejects.toThrow(/app_user_role_ck/);
    await expect(insert({ role: 'member', memberType: 'vip' })).rejects.toThrow(/app_user_member_type_ck/);
  });

  it('rejects two emails that differ only in letter case', async () => {
    const local = `case-${randomUUID()}`;
    await insert({ email: `${local}@X.se`, role: 'member', memberType: 'regular' });
    await expect(insert({ email: `${local}@x.se`, role: 'member', memberType: 'regular' })).rejects.toThrow(
      /app_user_email_lower_uq/,
    );
  });

  it('rejects an email shorter than 3 or longer than 254 characters and a blank name', async () => {
    await expect(insert({ email: 'a@', role: 'member', memberType: 'regular' })).rejects.toThrow(/app_user_email_len_ck/);
    await expect(
      insert({ email: `${'a'.repeat(250)}@x.se`, role: 'member', memberType: 'regular' }),
    ).rejects.toThrow(/app_user_email_len_ck/);
    await expect(
      sql`INSERT INTO app_user (email, full_name, role, member_type) VALUES (${newEmail()}, '   ', 'member', 'regular')`.execute(db),
    ).rejects.toThrow(/app_user_full_name_len_ck/);
  });

  it('rejects a duplicate legacy_member_id', async () => {
    const legacy = `L-${randomUUID()}`;
    const insertLegacy = () =>
      sql`INSERT INTO app_user (email, full_name, role, member_type, legacy_member_id) VALUES (${newEmail()}, 'Test', 'member', 'regular', ${legacy})`.execute(db);
    await insertLegacy();
    await expect(insertLegacy()).rejects.toThrow(/app_user_legacy_member_id_uq/);
  });
});

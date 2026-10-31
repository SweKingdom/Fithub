import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { verifyPassword } from '../../src/modules/auth/password.js';
import { createSession } from '../../src/modules/auth/session.js';
import { createUser, setPassword, UserAdminError } from '../../src/modules/auth/user-admin.js';
import { testDb } from '../helpers/db.js';
import { createClub } from '../helpers/factories.js';

const COST = 16384;
const PASSWORD = 'correct-horse-battery';
const sessionCfg = loadConfig({}).auth;

describe('operator account commands (US-118 AC 10)', () => {
  const db = testDb();
  let clubCode: string;

  beforeAll(async () => {
    const club = await createClub(db, { name: `Club ${randomUUID()}`, timezone: 'Europe/Stockholm' });
    clubCode = club.code;
  });

  const newEmail = () => `user-${randomUUID()}@example.com`;
  const countUsers = async (email: string) =>
    (await db.selectFrom('app_user').select('id').where('email', '=', email).execute()).length;

  it('creates an instructor with a scrypt hash, a normalised email and the club', async () => {
    const email = newEmail();
    const created = await createUser(
      db,
      { email: `  ${email.toUpperCase()} `, fullName: ' Anna Berg ', role: 'instructor', clubCode, password: PASSWORD },
      COST,
    );
    const row = await db.selectFrom('app_user').selectAll().where('id', '=', created.id).executeTakeFirstOrThrow();
    expect(row.email).toBe(email);
    expect(row.full_name).toBe('Anna Berg');
    expect(row.role).toBe('instructor');
    expect(row.member_type).toBeNull();
    expect(row.club_id).not.toBeNull();
    expect(row.password_hash).toMatch(/^scrypt\$16384\$/);
    await expect(verifyPassword(PASSWORD, row.password_hash as string)).resolves.toBe(true);
  });

  it('creates a member with a member type and no club', async () => {
    const created = await createUser(
      db,
      { email: newEmail(), fullName: 'Mia Member', role: 'member', memberType: 'drop_in', password: PASSWORD },
      COST,
    );
    expect(created).toMatchObject({ role: 'member', memberType: 'drop_in' });
  });

  it('accepts a lower-case club code', async () => {
    const created = await createUser(
      db,
      { email: newEmail(), fullName: 'Kim Club', role: 'club_manager', clubCode: clubCode.toLowerCase(), password: PASSWORD },
      COST,
    );
    expect(created.role).toBe('club_manager');
  });

  it('rejects a duplicate email, whatever its letter case, and creates nothing', async () => {
    const email = newEmail();
    await createUser(db, { email, fullName: 'First', role: 'instructor', clubCode, password: PASSWORD }, COST);
    await expect(
      createUser(db, { email: email.toUpperCase(), fullName: 'Second', role: 'instructor', clubCode, password: PASSWORD }, COST),
    ).rejects.toThrow(`A user with email ${email} already exists.`);
    expect(await countUsers(email)).toBe(1);
  });

  it.each([
    ['an unknown club code', { role: 'instructor', clubCode: 'NO-SUCH-CLUB' }, 'Club NO-SUCH-CLUB does not exist.'],
    ['staff without a club', { role: 'club_manager' }, 'Instructors and club managers need --club.'],
    ['a member without a member type', { role: 'member' }, 'Members need --member-type (regular or drop_in).'],
    ['staff with a member type', { role: 'instructor', clubCode: 'ANY', memberType: 'regular' }, 'Staff accounts have no member type.'],
  ])('rejects %s and creates nothing', async (_name, fields, message) => {
    const email = newEmail();
    const error = await createUser(db, { email, fullName: 'Test User', password: PASSWORD, ...fields }, COST).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(UserAdminError);
    expect((error as Error).message).toBe(message);
    expect(await countUsers(email)).toBe(0);
  });

  it('rejects a password shorter than 12 characters and creates nothing', async () => {
    const email = newEmail();
    await expect(
      createUser(db, { email, fullName: 'Short Pass', role: 'instructor', clubCode, password: '12345678901' }, COST),
    ).rejects.toThrow('Password must be at least 12 characters.');
    expect(await countUsers(email)).toBe(0);
  });

  it('accepts a password of exactly 12 characters', async () => {
    const created = await createUser(
      db,
      { email: newEmail(), fullName: 'Twelve', role: 'instructor', clubCode, password: '123456789012' },
      COST,
    );
    expect(created.id).toBeDefined();
  });

  it('set-password replaces the password and deletes all sessions of that user only', async () => {
    const email = newEmail();
    const user = await createUser(db, { email, fullName: 'Pw Change', role: 'instructor', clubCode, password: PASSWORD }, COST);
    const other = await createUser(db, { email: newEmail(), fullName: 'Other', role: 'instructor', clubCode, password: PASSWORD }, COST);
    const now = new Date();
    await createSession(db, user.id, now, sessionCfg);
    await createSession(db, user.id, now, sessionCfg);
    await createSession(db, other.id, now, sessionCfg);

    const result = await setPassword(db, email.toUpperCase(), 'another-long-password', COST);
    expect(result).toEqual({ email, sessionsEnded: 2 });

    const row = await db.selectFrom('app_user').select('password_hash').where('id', '=', user.id).executeTakeFirstOrThrow();
    await expect(verifyPassword('another-long-password', row.password_hash as string)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, row.password_hash as string)).resolves.toBe(false);
    expect(await db.selectFrom('user_session').select('id').where('user_id', '=', user.id).execute()).toHaveLength(0);
    expect(await db.selectFrom('user_session').select('id').where('user_id', '=', other.id).execute()).toHaveLength(1);
  });

  it('set-password rejects a short password and an unknown email without changing anything', async () => {
    const email = newEmail();
    const user = await createUser(db, { email, fullName: 'Keep Pw', role: 'instructor', clubCode, password: PASSWORD }, COST);
    const before = await db.selectFrom('app_user').select('password_hash').where('id', '=', user.id).executeTakeFirstOrThrow();

    await expect(setPassword(db, email, 'short', COST)).rejects.toThrow('Password must be at least 12 characters.');
    await expect(setPassword(db, 'nobody@example.com', PASSWORD, COST)).rejects.toThrow(
      'No user with email nobody@example.com exists.',
    );

    const after = await db.selectFrom('app_user').select('password_hash').where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(after.password_hash).toBe(before.password_hash);
  });
});

import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { AuthDatabase } from './db-types.js';
import type { AuthUser } from './types.js';

export interface SessionConfig {
  sessionIdleTimeoutMinutes: number;
  sessionMaxAgeHours: number;
}

type Db = Kysely<AuthDatabase>;

const TOUCH_AFTER_MS = 60 * 1000;
const MAX_TOKEN_LENGTH = 200;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Only this hash is stored; the token itself exists in the cookie alone. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createSession(
  db: Db,
  userId: string,
  now: Date,
  cfg: SessionConfig,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + cfg.sessionMaxAgeHours * HOUR_MS);
  await db
    .insertInto('user_session')
    .values({
      user_id: userId,
      token_hash: hashToken(token),
      created_at: now,
      last_seen_at: now,
      expires_at: expiresAt,
    })
    .execute();
  return { token, expiresAt };
}

/** The user of a valid session, or null. Valid = known token, not past `expires_at`, not idle too long. */
export async function resolveSession(
  db: Db,
  token: string,
  now: Date,
  cfg: SessionConfig,
): Promise<AuthUser | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const idleCutoff = new Date(now.getTime() - cfg.sessionIdleTimeoutMinutes * MINUTE_MS);

  const row = await db
    .selectFrom('user_session')
    .innerJoin('app_user', 'app_user.id', 'user_session.user_id')
    .select([
      'user_session.id as session_id',
      'user_session.last_seen_at',
      'app_user.id',
      'app_user.email',
      'app_user.full_name',
      'app_user.role',
      'app_user.member_type',
      'app_user.club_id',
    ])
    .where('user_session.token_hash', '=', hashToken(token))
    .where('user_session.expires_at', '>', now)
    .where('user_session.last_seen_at', '>', idleCutoff)
    .executeTakeFirst();
  if (!row) return null;

  if (now.getTime() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    await db.updateTable('user_session').set({ last_seen_at: now }).where('id', '=', row.session_id).execute();
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    memberType: row.member_type,
    clubId: row.club_id,
    sessionId: row.session_id,
  };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return;
  await db.deleteFrom('user_session').where('token_hash', '=', hashToken(token)).execute();
}

/** Ends every session of the user; returns how many were deleted. */
export async function deleteSessionsOfUser(db: Db, userId: string): Promise<number> {
  const result = await db.deleteFrom('user_session').where('user_id', '=', userId).executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Housekeeping at sign-in: there is no cleanup job (a few thousand rows). */
export async function deleteExpiredSessionsOfUser(
  db: Db,
  userId: string,
  now: Date,
  cfg: SessionConfig,
): Promise<void> {
  const idleCutoff = new Date(now.getTime() - cfg.sessionIdleTimeoutMinutes * MINUTE_MS);
  await db
    .deleteFrom('user_session')
    .where('user_id', '=', userId)
    .where((eb) => eb.or([eb('expires_at', '<=', now), eb('last_seen_at', '<=', idleCutoff)]))
    .execute();
}

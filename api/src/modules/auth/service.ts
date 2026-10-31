import type { Kysely } from 'kysely';
import type { BookingBlockReason } from '../../db/schema.js';
import type { BlockService } from '../attendance/block-service.js';
import type { AuthDatabase } from './db-types.js';
import { getDummyHash, verifyPassword } from './password.js';
import { findClubName, findUserByEmail, type AppUserRow } from './repository.js';
import {
  createSession,
  deleteExpiredSessionsOfUser,
  deleteSession,
  type SessionConfig,
} from './session.js';
import type { AuthUser, MemberType, Role } from './types.js';

type Db = Kysely<AuthDatabase>;

/** The member's active booking block (US-130). */
export interface BookingBlockDto {
  endsAt: string;
  reason: BookingBlockReason;
  noShowCount: number | null;
  message: string;
}

export interface MeDto {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  memberType: MemberType | null;
  clubId: string | null;
  clubName: string | null;
  /** Null when not blocked, and always null for staff. */
  bookingBlock: BookingBlockDto | null;
}

/**
 * The one place that checks a password. Unknown email, an account without a password and a wrong
 * password all return null after one scrypt run, so callers cannot tell them apart. SSO or an invite
 * flow can replace this function without touching the guards.
 */
export async function authenticate(
  db: Db,
  email: string,
  password: string,
  cfg: { scryptCost: number },
): Promise<AppUserRow | null> {
  const user = await findUserByEmail(db, email);
  if (!user?.password_hash) {
    await verifyPassword(password, await getDummyHash(cfg.scryptCost));
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}

/**
 * Starts a session for an authenticated user. Always issues a new token and drops the one in the
 * incoming cookie (prevents session fixation), and removes the user's expired sessions.
 */
export function login(
  db: Db,
  user: Pick<AppUserRow, 'id'>,
  now: Date,
  cfg: SessionConfig,
  incomingToken?: string,
): Promise<{ token: string; expiresAt: Date }> {
  return db.transaction().execute(async (trx) => {
    await deleteExpiredSessionsOfUser(trx, user.id, now, cfg);
    if (incomingToken) await deleteSession(trx, incomingToken);
    return createSession(trx, user.id, now, cfg);
  });
}

export function toMeDto(
  user: Omit<AuthUser, 'sessionId'>,
  club: { name: string } | null,
  bookingBlock: BookingBlockDto | null = null,
): MeDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    memberType: user.memberType,
    clubId: user.clubId,
    clubName: club?.name ?? null,
    bookingBlock,
  };
}

export function toAuthUser(row: AppUserRow): Omit<AuthUser, 'sessionId'> {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    memberType: row.member_type,
    clubId: row.club_id,
  };
}

/** The `MeDto` of a user, with the club name and (for members) the active booking block looked up. */
export async function buildMe(
  db: Db,
  user: Omit<AuthUser, 'sessionId'>,
  blocks: Pick<BlockService, 'getActiveBlock'>,
): Promise<MeDto> {
  const clubName = user.clubId === null ? null : await findClubName(db, user.clubId);
  const block = user.role === 'member' ? await blocks.getActiveBlock(db, user.id) : null;
  return toMeDto(
    user,
    clubName === null ? null : { name: clubName },
    block === null
      ? null
      : {
          endsAt: block.endsAt.toISOString(),
          reason: block.reason,
          noShowCount: block.noShowCount,
          message: block.message,
        },
  );
}

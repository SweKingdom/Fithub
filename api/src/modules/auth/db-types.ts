import type { ColumnType, Generated } from 'kysely';
import type { MemberType, Role } from './types.js';

/** `app_user` (migration 0002). */
export interface AppUserTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  role: Role;
  member_type: MemberType | null;
  club_id: string | null;
  password_hash: string | null;
  legacy_member_id: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

/** `user_session` (migration 0002). `token_hash` is the SHA-256 of the cookie value. */
export interface UserSessionTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

/** The columns of `club` (US-117) that the auth module reads. */
export interface AuthClubTable {
  id: string;
  code: string;
  name: string;
}

/** The tables the auth module touches. Merge into `db/schema.ts` once the shared schema file is on this branch. */
export interface AuthDatabase {
  app_user: AppUserTable;
  user_session: UserSessionTable;
  club: AuthClubTable;
}

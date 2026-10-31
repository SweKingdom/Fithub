import type { Generated } from 'kysely';
import type { AppUserTable, UserSessionTable } from '../modules/auth/db-types.js';

/** `club` (migration 0001, US-117). */
export interface ClubTable {
  id: Generated<string>;
  /** Short unique code that operators use on the command line. */
  code: string;
  name: string;
  /** IANA time zone, e.g. `Europe/Stockholm`. */
  timezone: string;
  created_at: Generated<Date>;
}

/** `gym_class` (migration 0003). */
export interface GymClassTable {
  id: Generated<string>;
  club_id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  status: Generated<'scheduled' | 'cancelled'>;
  instructor_id: string | null;
  created_at: Generated<Date>;
}

/** `booking` (migration 0004). */
export interface BookingTable {
  id: Generated<string>;
  class_id: string;
  member_id: string;
  status: 'confirmed' | 'pending_payment' | 'cancelled';
  created_at: Generated<Date>;
}

/** `import_member_alias` (migration 0020, US-135). */
export interface ImportMemberAliasTable {
  legacy_member_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

/** Every table the API reads or writes. */
export interface Database {
  club: ClubTable;
  app_user: AppUserTable;
  user_session: UserSessionTable;
  gym_class: GymClassTable;
  booking: BookingTable;
  import_member_alias: ImportMemberAliasTable;
}

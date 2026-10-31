import type { Generated } from 'kysely';
import type { AppUserTable, UserSessionTable } from '../modules/auth/db-types.js';
import type { ClubTable } from '../modules/clubs/db-types.js';
import type { WaitlistEntryTable } from '../modules/waitlist/table.js';

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

export type AttendanceStatus = 'unknown' | 'attended' | 'no_show';

/**
 * `booking` (migration 0004; `source` and `booked_at` from migration 0006; `attendance` and `no_show_block_id`
 * from migration 0021, US-130; `cancelled_at` from migration 0022, US-124).
 */
export interface BookingTable {
  id: Generated<string>;
  class_id: string;
  member_id: string;
  status: 'confirmed' | 'pending_payment' | 'cancelled';
  source: Generated<'direct' | 'waitlist'>;
  booked_at: Generated<Date>;
  attendance: Generated<AttendanceStatus>;
  /** The block this no-show was counted for; null while it is uncounted. */
  no_show_block_id: string | null;
  /** When the booking was cancelled; null while it is active. */
  cancelled_at: Date | null;
  created_at: Generated<Date>;
}

export type BookingBlockReason = 'no_show' | 'manual';

/** `booking_block` (migration 0021, US-130). A block is active while `starts_at <= now < ends_at`. */
export interface BookingBlockTable {
  id: Generated<string>;
  member_id: string;
  reason: BookingBlockReason;
  starts_at: Date;
  ends_at: Date;
  /** Number of no-shows counted when the block was created; null for a `manual` block. */
  no_show_count: number | null;
  lifted_at: Date | null;
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
  booking_block: BookingBlockTable;
  waitlist_entry: WaitlistEntryTable;
  import_member_alias: ImportMemberAliasTable;
}

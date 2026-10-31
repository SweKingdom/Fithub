import type { ColumnType, Generated } from 'kysely';

export type WaitlistEntryStatus = 'waiting' | 'promoted' | 'removed' | 'expired';

/** `waitlist_entry` (migration 0005, US-127). */
export interface WaitlistEntryTable {
  id: Generated<string>;
  class_id: string;
  member_id: string;
  /** `bigint` identity: `pg` returns it as a string. Queue order. */
  queue_seq: Generated<string>;
  status: Generated<WaitlistEntryStatus>;
  joined_at: Date;
  ended_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  promoted_booking_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

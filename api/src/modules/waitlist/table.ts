import type { ColumnType, Generated } from 'kysely';

export type WaitlistStatus = 'waiting' | 'promoted' | 'removed' | 'expired';

/**
 * Table `waitlist_entry` (US-127). Register as `waitlist_entry: WaitlistEntryTable` in `Database`
 * (`api/src/db/schema.ts`). `queue_seq` is a `bigint` identity column; `pg` returns it as a string.
 */
export interface WaitlistEntryTable {
  id: Generated<string>;
  class_id: string;
  member_id: string;
  queue_seq: ColumnType<string, never, never>;
  status: Generated<WaitlistStatus>;
  joined_at: Date;
  ended_at: Date | null;
  promoted_booking_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

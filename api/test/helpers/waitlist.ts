import type { Kysely } from 'kysely';
import type { Database } from '../../src/db/schema.js';
import type { WaitlistStatus } from '../../src/modules/waitlist/table.js';

export interface CreateWaitlistEntryInput {
  classId: string;
  memberId: string;
  status?: WaitlistStatus;
  joinedAt?: Date;
}

/**
 * Inserts a `waitlist_entry` directly (US-127). Entries that are not `waiting` get `ended_at`
 * (CHECK `waitlist_entry_ended_ck`). `queue_seq` follows insertion order.
 * Spec lists this as `createWaitlistEntry` in `helpers/factories.ts`; move it there when that file exists.
 */
export async function createWaitlistEntry(db: Kysely<Database>, input: CreateWaitlistEntryInput) {
  const status = input.status ?? 'waiting';
  const joinedAt = input.joinedAt ?? new Date('2026-11-01T08:00:00Z');
  return db
    .insertInto('waitlist_entry')
    .values({
      class_id: input.classId,
      member_id: input.memberId,
      status,
      joined_at: joinedAt,
      ended_at: status === 'waiting' ? null : joinedAt,
      promoted_booking_id: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

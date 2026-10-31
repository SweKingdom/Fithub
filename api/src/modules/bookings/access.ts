import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

/**
 * Ownership lookups in SQL (ADR-011): a row that belongs to someone else is indistinguishable
 * from a row that does not exist. Created by US-127; US-123 adds its booking lookups here.
 */

/** The member's own waiting-list entry, or `undefined` when unknown or owned by another member. */
export async function findOwnWaitlistEntry(
  executor: Kysely<Database>,
  entryId: string,
  memberId: string,
): Promise<{ id: string; class_id: string; status: string } | undefined> {
  return executor
    .selectFrom('waitlist_entry')
    .select(['id', 'class_id', 'status'])
    .where('id', '=', entryId)
    .where('member_id', '=', memberId)
    .executeTakeFirst();
}

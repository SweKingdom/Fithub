import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { MemberType } from '../auth/types.js';

/** A `waiting` entry together with what promotion needs to know about the member. */
export interface WaitingCandidate {
  id: string;
  member_id: string;
  queue_seq: string;
  member_type: MemberType | null;
}

/** The `waiting` entries of a class, first joined first. The caller holds the class lock, so no row lock is needed. */
export async function listWaitingForPromotion(
  trx: Kysely<Database>,
  classId: string,
): Promise<WaitingCandidate[]> {
  return trx
    .selectFrom('waitlist_entry as e')
    .innerJoin('app_user as u', 'u.id', 'e.member_id')
    .select(['e.id', 'e.member_id', 'e.queue_seq', 'u.member_type'])
    .where('e.class_id', '=', classId)
    .where('e.status', '=', 'waiting')
    .orderBy('e.queue_seq')
    .execute();
}

/** `waiting` → `removed` (the member can no longer be promoted). Returns false when the entry was not `waiting`. */
export async function markRemoved(trx: Kysely<Database>, entryId: string, now: Date): Promise<boolean> {
  const row = await trx
    .updateTable('waitlist_entry')
    .set({ status: 'removed', ended_at: now, updated_at: now })
    .where('id', '=', entryId)
    .where('status', '=', 'waiting')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * `waiting` → `promoted`. Returns false when the entry was no longer `waiting` (a concurrent leave won the row),
 * so the caller must not give that member a place.
 */
export async function claimEntry(trx: Kysely<Database>, entryId: string, now: Date): Promise<boolean> {
  const row = await trx
    .updateTable('waitlist_entry')
    .set({ status: 'promoted', ended_at: now, updated_at: now })
    .where('id', '=', entryId)
    .where('status', '=', 'waiting')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export async function setPromotedBooking(trx: Kysely<Database>, entryId: string, bookingId: string): Promise<void> {
  await trx
    .updateTable('waitlist_entry')
    .set({ promoted_booking_id: bookingId })
    .where('id', '=', entryId)
    .execute();
}

/**
 * Every `waiting` entry of a class that has reached the promotion cut-off (`start_at − cutoff <= now`) becomes
 * `expired`. Idempotent. Returns how many entries changed.
 */
export async function expireEntries(db: Kysely<Database>, now: Date, cutoffMinutes: number): Promise<number> {
  const result = await sql`
    UPDATE waitlist_entry e
    SET status = 'expired', ended_at = ${now}, updated_at = ${now}
    FROM gym_class c
    WHERE e.class_id = c.id
      AND e.status = 'waiting'
      AND c.start_at - make_interval(mins => ${cutoffMinutes}) <= ${now}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

/**
 * Ids of `scheduled` classes before their cut-off that have a free place and at least one `waiting` entry,
 * soonest class first.
 */
export async function findClassesNeedingPromotion(
  db: Kysely<Database>,
  now: Date,
  cutoffMinutes: number,
): Promise<string[]> {
  const result = await sql<{ id: string }>`
    SELECT c.id
    FROM gym_class c
    WHERE c.status = 'scheduled'
      AND c.start_at - make_interval(mins => ${cutoffMinutes}) > ${now}
      AND EXISTS (
        SELECT 1 FROM waitlist_entry w WHERE w.class_id = c.id AND w.status = 'waiting'
      )
      AND c.capacity > (
        SELECT count(*) FROM booking b
        WHERE b.class_id = c.id AND b.status IN ('confirmed', 'pending_payment')
      )
    ORDER BY c.start_at, c.id
  `.execute(db);
  return result.rows.map((row) => row.id);
}

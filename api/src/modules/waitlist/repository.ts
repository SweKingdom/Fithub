import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { WaitlistEntryDtoRow } from './dto.js';

/** A `Kysely<Database>` or a `Transaction<Database>` (which extends it). */
export type Executor = Kysely<Database>;

export interface NewWaitlistEntry {
  class_id: string;
  member_id: string;
  joined_at: Date;
}

export interface LockedWaitlistEntry {
  id: string;
  class_id: string;
  status: 'waiting' | 'promoted' | 'removed' | 'expired';
}

export interface ActiveWaitlistEntryRow extends WaitlistEntryDtoRow {
  position: number;
}

/** The member's `waiting` entry on the class, if any. */
export async function findWaitingEntry(
  executor: Executor,
  classId: string,
  memberId: string,
): Promise<{ id: string } | undefined> {
  return executor
    .selectFrom('waitlist_entry')
    .select('id')
    .where('class_id', '=', classId)
    .where('member_id', '=', memberId)
    .where('status', '=', 'waiting')
    .executeTakeFirst();
}

/** Inserts a `waiting` entry. `queue_seq` comes from the identity column. */
export async function insertEntry(executor: Executor, row: NewWaitlistEntry): Promise<{ id: string }> {
  return executor
    .insertInto('waitlist_entry')
    .values({ class_id: row.class_id, member_id: row.member_id, status: 'waiting', joined_at: row.joined_at })
    .returning('id')
    .executeTakeFirstOrThrow();
}

/** Row lock on the entry. Callers lock the `gym_class` row first (ADR-010). */
export async function lockEntry(executor: Executor, entryId: string): Promise<LockedWaitlistEntry | undefined> {
  return executor
    .selectFrom('waitlist_entry')
    .select(['id', 'class_id', 'status'])
    .where('id', '=', entryId)
    .forUpdate()
    .executeTakeFirst();
}

export async function markRemoved(executor: Executor, entryId: string, now: Date): Promise<void> {
  await executor
    .updateTable('waitlist_entry')
    .set({ status: 'removed', ended_at: now, updated_at: now })
    .where('id', '=', entryId)
    .execute();
}

/** Direct booking: the member's `waiting` entry on the class becomes `removed`. */
export async function removeWaitingForMember(
  executor: Executor,
  classId: string,
  memberId: string,
  now: Date,
): Promise<void> {
  await executor
    .updateTable('waitlist_entry')
    .set({ status: 'removed', ended_at: now, updated_at: now })
    .where('class_id', '=', classId)
    .where('member_id', '=', memberId)
    .where('status', '=', 'waiting')
    .execute();
}

/**
 * 1-based position: `waiting` entries on the same class with `queue_seq` up to the entry's own.
 * `null` when the entry is not `waiting`. Position is never stored.
 */
export async function positionOf(executor: Executor, entryId: string): Promise<number | null> {
  const row = await executor
    .selectFrom('waitlist_entry as e')
    .innerJoin('waitlist_entry as w', (join) =>
      join
        .onRef('w.class_id', '=', 'e.class_id')
        .on('w.status', '=', 'waiting')
        .onRef('w.queue_seq', '<=', 'e.queue_seq'),
    )
    .where('e.id', '=', entryId)
    .where('e.status', '=', 'waiting')
    .select((eb) => eb.fn.countAll<string>().as('position'))
    .executeTakeFirst();
  const position = Number(row?.position ?? 0);
  return position > 0 ? position : null;
}

function selectEntryDtoRow(executor: Executor) {
  return executor
    .selectFrom('waitlist_entry as e')
    .innerJoin('gym_class as c', 'c.id', 'e.class_id')
    .innerJoin('club as cl', 'cl.id', 'c.club_id')
    .select([
      'e.id as id',
      'e.class_id as class_id',
      'c.name as class_name',
      'cl.id as club_id',
      'cl.name as club_name',
      'c.start_at as start_at',
      'c.duration_minutes as duration_minutes',
      'c.status as class_status',
      'e.status as status',
      'e.joined_at as joined_at',
      'e.promoted_booking_id as promoted_booking_id',
    ]);
}

/** The entry with its class and club, as needed by `toWaitlistEntryDto`. */
export async function findEntryDtoRow(
  executor: Executor,
  entryId: string,
): Promise<WaitlistEntryDtoRow | undefined> {
  return selectEntryDtoRow(executor).where('e.id', '=', entryId).executeTakeFirst();
}

/**
 * The member's `waiting` entries on scheduled classes that have not started, with positions,
 * soonest class first (consumed by US-123).
 */
export async function listActiveEntriesForMember(
  executor: Executor,
  memberId: string,
  now: Date,
): Promise<ActiveWaitlistEntryRow[]> {
  const rows = await selectEntryDtoRow(executor)
    .select(
      sql<string>`(SELECT count(*) FROM waitlist_entry w
        WHERE w.class_id = e.class_id AND w.status = 'waiting' AND w.queue_seq <= e.queue_seq)`.as('position'),
    )
    .where('e.member_id', '=', memberId)
    .where('e.status', '=', 'waiting')
    .where('c.status', '=', 'scheduled')
    .where('c.start_at', '>', now)
    .orderBy('c.start_at')
    .orderBy('e.queue_seq')
    .execute();
  return rows.map((row) => ({ ...row, position: Number(row.position) }));
}

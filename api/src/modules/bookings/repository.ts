import type { Insertable, Kysely, Selectable } from 'kysely';
import type { BookingTable, Database, GymClassTable } from '../../db/schema.js';

/** A booking holds a place while it is `confirmed` or `pending_payment`. */
const ACTIVE_STATUSES = ['confirmed', 'pending_payment'] as const;

export type LockedClass = Pick<Selectable<GymClassTable>, 'id' | 'status' | 'start_at' | 'capacity'>;

/**
 * Takes the `gym_class` row lock (`SELECT … FOR UPDATE`, ADR-010). Place allocation on one class runs one
 * transaction at a time. Asking again in the same transaction is a no-op. `undefined` when the class does not exist.
 */
export async function lockClassForUpdate(
  trx: Kysely<Database>,
  classId: string,
): Promise<LockedClass | undefined> {
  return trx
    .selectFrom('gym_class')
    .select(['id', 'status', 'start_at', 'capacity'])
    .where('id', '=', classId)
    .forUpdate()
    .executeTakeFirst();
}

/** Number of bookings that hold a place on the class. */
export async function countActiveBookings(executor: Kysely<Database>, classId: string): Promise<number> {
  const row = await executor
    .selectFrom('booking')
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .where('class_id', '=', classId)
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

/** The member's `confirmed` or `pending_payment` booking on the class, if any. */
export async function findActiveBooking(
  executor: Kysely<Database>,
  classId: string,
  memberId: string,
): Promise<{ id: string; status: BookingTable['status'] } | undefined> {
  return executor
    .selectFrom('booking')
    .select(['id', 'status'])
    .where('class_id', '=', classId)
    .where('member_id', '=', memberId)
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirst();
}

export async function insertBooking(
  trx: Kysely<Database>,
  row: Insertable<BookingTable>,
): Promise<{ id: string }> {
  return trx.insertInto('booking').values(row).returning('id').executeTakeFirstOrThrow();
}

import { sql, type Kysely } from 'kysely';
import type { BookingDatabase, BookingSource, BookingStatus } from './db-types.js';
import type { BookingRow } from './dto.js';

type Db = Kysely<BookingDatabase>;

const ACTIVE_STATUSES: BookingStatus[] = ['confirmed', 'pending_payment'];

export interface LockedClass {
  id: string;
  status: 'scheduled' | 'cancelled';
  start_at: Date;
  capacity: number;
}

export interface NewBooking {
  class_id: string;
  member_id: string;
  status: Extract<BookingStatus, 'confirmed' | 'pending_payment'>;
  source: BookingSource;
  booked_at: Date;
}

/** Locks the class row until the transaction ends; every place allocation takes this lock first (ADR-010). */
export function lockClassForUpdate(trx: Db, classId: string): Promise<LockedClass | undefined> {
  return trx
    .selectFrom('gym_class')
    .select(['id', 'status', 'start_at', 'capacity'])
    .where('id', '=', classId)
    .forUpdate()
    .executeTakeFirst();
}

/** Bookings that hold a place: `confirmed` or `pending_payment`. */
export async function countActiveBookings(trx: Db, classId: string): Promise<number> {
  const row = await trx
    .selectFrom('booking')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('class_id', '=', classId)
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirstOrThrow();
  return row.count;
}

export async function findActiveBooking(trx: Db, classId: string, memberId: string): Promise<{ id: string } | undefined> {
  return trx
    .selectFrom('booking')
    .select('id')
    .where('class_id', '=', classId)
    .where('member_id', '=', memberId)
    .where('status', 'in', ACTIVE_STATUSES)
    .executeTakeFirst();
}

export async function insertBooking(trx: Db, row: NewBooking): Promise<string> {
  const inserted = await trx.insertInto('booking').values(row).returning('id').executeTakeFirstOrThrow();
  return inserted.id;
}

export function findBookingRowById(db: Db, id: string): Promise<BookingRow | undefined> {
  return db
    .selectFrom('booking as b')
    .innerJoin('gym_class as gc', 'gc.id', 'b.class_id')
    .innerJoin('club as c', 'c.id', 'gc.club_id')
    .select([
      'b.id',
      'b.class_id',
      'b.member_id',
      'b.status',
      'b.attendance',
      'b.source',
      'b.booked_at',
      'b.cancelled_at',
      'gc.name as class_name',
      'gc.club_id',
      'c.name as club_name',
      'gc.start_at',
      'gc.duration_minutes',
      'gc.status as class_status',
    ])
    .where('b.id', '=', id)
    .executeTakeFirst();
}

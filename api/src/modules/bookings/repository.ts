import { sql, type Expression, type ExpressionBuilder, type Insertable, type Kysely, type Selectable, type SqlBool } from 'kysely';
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

export type BookingPeriod = 'upcoming' | 'past';

type BookingEb = ExpressionBuilder<Database, 'booking' | 'gym_class' | 'club' | 'app_user'>;

/** A booking with its class, club and member name. Every access query below adds its own owner or club filter. */
function bookingRows(db: Kysely<Database>) {
  return db
    .selectFrom('booking')
    .innerJoin('gym_class', 'gym_class.id', 'booking.class_id')
    .innerJoin('club', 'club.id', 'gym_class.club_id')
    .innerJoin('app_user', 'app_user.id', 'booking.member_id')
    .select([
      'booking.id as id',
      'booking.member_id as member_id',
      'booking.class_id as class_id',
      'booking.status as status',
      'booking.attendance as attendance',
      'gym_class.name as class_name',
      'gym_class.start_at as start_at',
      'gym_class.duration_minutes as duration_minutes',
      'club.name as club_name',
      'club.timezone as club_timezone',
      'app_user.full_name as member_name',
    ]);
}

export type BookingRow = Awaited<ReturnType<ReturnType<typeof bookingRows>['executeTakeFirstOrThrow']>>;

const CLASS_END = sql<Date>`gym_class.start_at + gym_class.duration_minutes * interval '1 minute'`;

/** The member's own bookings of one period: upcoming = active on a class that has not ended; past = any status on an ended class. */
function memberScope(memberId: string, period: BookingPeriod, now: Date) {
  return (eb: BookingEb): Expression<SqlBool> =>
    period === 'upcoming'
      ? eb.and([
          eb('booking.member_id', '=', memberId),
          eb('booking.status', 'in', ACTIVE_STATUSES),
          eb(CLASS_END, '>', now),
        ])
      : eb.and([eb('booking.member_id', '=', memberId), eb(CLASS_END, '<=', now)]);
}

/** One page of the member's bookings (soonest first for upcoming, most recent first for past) and the total. */
export async function listMemberBookings(
  db: Kysely<Database>,
  memberId: string,
  period: BookingPeriod,
  now: Date,
  limit: number,
  offset: number,
): Promise<{ rows: BookingRow[]; total: number }> {
  const scope = memberScope(memberId, period, now);
  const rows = await bookingRows(db)
    .where(scope)
    .orderBy('gym_class.start_at', period === 'upcoming' ? 'asc' : 'desc')
    .orderBy('booking.id')
    .limit(limit)
    .offset(offset)
    .execute();
  const count = await bookingRows(db)
    .clearSelect()
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .where(scope)
    .executeTakeFirstOrThrow();
  return { rows, total: Number(count.total) };
}

/** The booking only when it belongs to the member (ownership is part of the `WHERE`). */
export async function findBookingForMember(
  db: Kysely<Database>,
  id: string,
  memberId: string,
): Promise<BookingRow | undefined> {
  return bookingRows(db).where('booking.id', '=', id).where('booking.member_id', '=', memberId).executeTakeFirst();
}

/** The booking only when its class belongs to the club. */
export async function findBookingForClub(
  db: Kysely<Database>,
  id: string,
  clubId: string,
): Promise<BookingRow | undefined> {
  return bookingRows(db).where('booking.id', '=', id).where('gym_class.club_id', '=', clubId).executeTakeFirst();
}

/** The member's own booking (id, class, status). With `lock` the booking row is locked (`FOR UPDATE`). */
export async function findOwnBooking(
  executor: Kysely<Database>,
  id: string,
  memberId: string,
  lock: boolean,
): Promise<{ id: string; class_id: string; status: BookingTable['status'] } | undefined> {
  const query = executor
    .selectFrom('booking')
    .select(['id', 'class_id', 'status'])
    .where('id', '=', id)
    .where('member_id', '=', memberId);
  return (lock ? query.forUpdate() : query).executeTakeFirst();
}

export async function markBookingCancelled(trx: Kysely<Database>, id: string): Promise<void> {
  await trx.updateTable('booking').set({ status: 'cancelled' }).where('id', '=', id).execute();
}

export async function findClassForRoster(
  db: Kysely<Database>,
  classId: string,
): Promise<{ id: string; club_id: string; capacity: number } | undefined> {
  return db
    .selectFrom('gym_class')
    .select(['id', 'club_id', 'capacity'])
    .where('id', '=', classId)
    .executeTakeFirst();
}

/** Active bookings of the class by member name. Names only: the member's e-mail is never selected. */
export async function listClassRoster(db: Kysely<Database>, classId: string) {
  return db
    .selectFrom('booking')
    .innerJoin('app_user', 'app_user.id', 'booking.member_id')
    .select([
      'booking.id as booking_id',
      'booking.member_id as member_id',
      'app_user.full_name as member_name',
      'booking.status as status',
      'booking.attendance as attendance',
      'booking.booked_at as booked_at',
    ])
    .where('booking.class_id', '=', classId)
    .where('booking.status', 'in', ACTIVE_STATUSES)
    .orderBy('app_user.full_name')
    .orderBy('booking.id')
    .execute();
}

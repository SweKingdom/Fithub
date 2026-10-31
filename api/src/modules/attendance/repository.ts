import { sql, type Kysely, type Transaction } from 'kysely';
import type { Attendance, Database } from '../../db/schema.js';

export interface ClassRow {
  id: string;
  club_id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  status: 'scheduled' | 'cancelled';
}

export interface RosterRow {
  booking_id: string;
  member_id: string;
  member_name: string;
  attendance: Attendance;
  recorded_at: Date | null;
  recorded_by_name: string | null;
}

export interface LockedBooking {
  id: string;
  member_id: string;
  status: 'confirmed' | 'pending_payment' | 'cancelled';
  attendance: Attendance;
}

export interface StartedClassRow {
  id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  club_timezone: string;
}

const CLASS_COLUMNS = ['id', 'club_id', 'name', 'start_at', 'duration_minutes', 'status'] as const;

/** The class without a lock (read path). */
export function findClassById(db: Kysely<Database>, classId: string): Promise<ClassRow | undefined> {
  return db.selectFrom('gym_class').select(CLASS_COLUMNS).where('id', '=', classId).executeTakeFirst();
}

/** The class with its row locked: place allocation and attendance both serialise on it (ADR-010). */
export function lockClass(trx: Transaction<Database>, classId: string): Promise<ClassRow | undefined> {
  return trx.selectFrom('gym_class').select(CLASS_COLUMNS).where('id', '=', classId).forUpdate().executeTakeFirst();
}

/** Like `lockClass`, but a class that another transaction holds is skipped (several API instances). */
export function lockClassSkipLocked(trx: Transaction<Database>, classId: string): Promise<ClassRow | undefined> {
  return trx
    .selectFrom('gym_class')
    .select(CLASS_COLUMNS)
    .where('id', '=', classId)
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();
}

/**
 * Scheduled classes of the club that started in `(since, now]`, newest first: the entry point to the
 * attendance list, because the public schedule never returns started classes. Read-only, no locks.
 */
export function findStartedClasses(
  db: Kysely<Database>,
  clubId: string,
  since: Date,
  now: Date,
): Promise<StartedClassRow[]> {
  return db
    .selectFrom('gym_class as gc')
    .innerJoin('club as c', 'c.id', 'gc.club_id')
    .select(['gc.id', 'gc.name', 'gc.start_at', 'gc.duration_minutes', 'c.timezone as club_timezone'])
    .where('gc.club_id', '=', clubId)
    .where('gc.status', '=', 'scheduled')
    .where('gc.start_at', '>', since)
    .where('gc.start_at', '<=', now)
    .orderBy('gc.start_at', 'desc')
    .orderBy('gc.id', 'asc')
    .execute();
}

/** Confirmed bookings of the class with the member's name (never the e-mail address), ordered by name. */
export function listAttendanceRoster(db: Kysely<Database>, classId: string): Promise<RosterRow[]> {
  return db
    .selectFrom('booking as b')
    .innerJoin('app_user as m', 'm.id', 'b.member_id')
    .leftJoin('app_user as r', 'r.id', 'b.attendance_recorded_by')
    .select([
      'b.id as booking_id',
      'b.member_id',
      'm.full_name as member_name',
      'b.attendance',
      'b.attendance_recorded_at as recorded_at',
      'r.full_name as recorded_by_name',
    ])
    .where('b.class_id', '=', classId)
    .where('b.status', '=', 'confirmed')
    .orderBy('m.full_name', 'asc')
    .orderBy('b.id', 'asc')
    .execute();
}

/**
 * Locks the requested bookings of this class, ordered by member (same order as the no-show block of
 * US-130, so the two never deadlock). Ids that are not bookings of the class are simply missing.
 */
export function lockBookingsOfClass(
  trx: Transaction<Database>,
  classId: string,
  bookingIds: string[],
): Promise<LockedBooking[]> {
  return trx
    .selectFrom('booking')
    .select(['id', 'member_id', 'status', 'attendance'])
    .where('class_id', '=', classId)
    .where('id', 'in', bookingIds)
    .orderBy('member_id', 'asc')
    .forUpdate()
    .execute();
}

/** Locks the confirmed bookings of the class that have no attendance yet, ordered by member. */
export function lockUnrecordedBookings(
  trx: Transaction<Database>,
  classId: string,
): Promise<Pick<LockedBooking, 'id' | 'member_id' | 'attendance'>[]> {
  return trx
    .selectFrom('booking')
    .select(['id', 'member_id', 'attendance'])
    .where('class_id', '=', classId)
    .where('status', '=', 'confirmed')
    .where('attendance', '=', 'unknown')
    .orderBy('member_id', 'asc')
    .forUpdate()
    .execute();
}

export async function updateAttendance(
  trx: Transaction<Database>,
  bookingId: string,
  attendance: 'attended' | 'no_show',
  recordedBy: string | null,
  recordedAt: Date,
): Promise<void> {
  await trx
    .updateTable('booking')
    .set({ attendance, attendance_recorded_by: recordedBy, attendance_recorded_at: recordedAt })
    .where('id', '=', bookingId)
    .execute();
}

/**
 * Ids of scheduled classes whose attendance window has closed and that still have a confirmed booking
 * without attendance; oldest first. Read-only, no locks.
 */
export async function findClassesDueForAutoNoShow(
  db: Kysely<Database>,
  now: Date,
  editWindowHours: number,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .selectFrom('gym_class as gc')
    .select('gc.id')
    .where('gc.status', '=', 'scheduled')
    .where(
      sql<boolean>`gc.start_at + make_interval(mins => gc.duration_minutes) + make_interval(hours => ${editWindowHours}::int) <= ${now}`,
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('booking as b')
          .select('b.id')
          .whereRef('b.class_id', '=', 'gc.id')
          .where('b.status', '=', 'confirmed')
          .where('b.attendance', '=', 'unknown'),
      ),
    )
    .orderBy('gc.start_at', 'asc')
    .orderBy('gc.id', 'asc')
    .limit(limit)
    .execute();
  return rows.map((row) => row.id);
}

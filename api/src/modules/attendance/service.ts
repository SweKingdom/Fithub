import type { Kysely } from 'kysely';
import type { AttendanceConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { EventPublisher } from '../../shared/domain-events.js';
import type { Clock } from '../../shared/clock.js';
import type { FieldError } from '../../shared/errors.js';
import type { AuthUser } from '../auth/types.js';
import { assertStaffOfClass } from '../bookings/access.js';
import { findClubById } from '../clubs/repository.js';
import { classCancelled, classNotFound } from '../classes/errors.js';
import type { AttendanceEntry, AttendanceRoster } from './dto.js';
import { attendanceClosed, attendanceNotOpen, attendanceValidation, NOT_ON_LIST_MESSAGE } from './errors.js';
import {
  findClassById,
  listAttendanceRoster,
  lockBookingsOfClass,
  lockClass,
  updateAttendance,
  type ClassRow,
} from './repository.js';
import { attendanceWindow, canEditAttendance } from './window.js';

export interface AttendanceDeps {
  db: Kysely<Database>;
  clock: Clock;
  events: EventPublisher;
  config: AttendanceConfig;
}

const MINUTE_MS = 60 * 1000;

/** The roster of confirmed bookings with summary and window. `db` may be a transaction. */
async function buildRoster(
  deps: AttendanceDeps,
  db: Kysely<Database>,
  user: AuthUser,
  gymClass: ClassRow,
  now: Date,
): Promise<AttendanceRoster> {
  const window = attendanceWindow(gymClass, now, deps.config.editWindowHours);
  const rows = await listAttendanceRoster(db, gymClass.id);
  // The class has a club (foreign key); the fallback only keeps the type honest.
  const club = await findClubById(db, gymClass.club_id);

  return {
    classId: gymClass.id,
    className: gymClass.name,
    startAt: gymClass.start_at.toISOString(),
    endsAt: new Date(gymClass.start_at.getTime() + gymClass.duration_minutes * MINUTE_MS).toISOString(),
    clubTimezone: club?.timezone ?? 'UTC',
    classStatus: gymClass.status,
    window: {
      opensAt: window.opensAt.toISOString(),
      closesAt: window.closesAt.toISOString(),
      state: window.state,
    },
    canEdit: canEditAttendance(user, window),
    summary: {
      booked: rows.length,
      attended: rows.filter((row) => row.attendance === 'attended').length,
      noShows: rows.filter((row) => row.attendance === 'no_show').length,
      unknown: rows.filter((row) => row.attendance === 'unknown').length,
    },
    items: rows.map((row) => ({
      bookingId: row.booking_id,
      memberId: row.member_id,
      memberName: row.member_name,
      attendance: row.attendance,
      recordedAt: row.recorded_at === null ? null : row.recorded_at.toISOString(),
      recordedByName: row.recorded_by_name,
    })),
  };
}

/** The attendance roster of a class. Works in every window state, so staff can always view it. */
export async function getAttendance(deps: AttendanceDeps, user: AuthUser, classId: string): Promise<AttendanceRoster> {
  const gymClass = await findClassById(deps.db, classId);
  if (!gymClass) throw classNotFound();
  assertStaffOfClass(user, gymClass);
  if (gymClass.status === 'cancelled') throw classCancelled();
  return buildRoster(deps, deps.db, user, gymClass, deps.clock.now());
}

/**
 * Saves attendance for confirmed bookings of the class, all or nothing, in one transaction that
 * holds the class lock first (ADR-010). Entries that do not change a booking write and publish nothing.
 */
export async function recordAttendance(
  deps: AttendanceDeps,
  user: AuthUser,
  classId: string,
  entries: AttendanceEntry[],
): Promise<AttendanceRoster> {
  return deps.db.transaction().execute(async (trx) => {
    const gymClass = await lockClass(trx, classId);
    if (!gymClass) throw classNotFound();
    assertStaffOfClass(user, gymClass);
    if (gymClass.status === 'cancelled') throw classCancelled();

    const now = deps.clock.now();
    const window = attendanceWindow(gymClass, now, deps.config.editWindowHours);
    if (window.state === 'not_open') throw attendanceNotOpen();
    if (!canEditAttendance(user, window)) throw attendanceClosed();

    const locked = await lockBookingsOfClass(
      trx,
      classId,
      entries.map((entry) => entry.bookingId),
    );
    const byId = new Map(locked.map((booking) => [booking.id, booking]));

    const fieldErrors: FieldError[] = [];
    entries.forEach((entry, index) => {
      if (byId.get(entry.bookingId)?.status !== 'confirmed') {
        fieldErrors.push({ field: `entries[${index}].bookingId`, message: NOT_ON_LIST_MESSAGE });
      }
    });
    if (fieldErrors.length > 0) throw attendanceValidation(fieldErrors);

    const requested = new Map(entries.map((entry) => [entry.bookingId, entry.attendance]));
    // `locked` is ordered by member: the same lock order as the no-show block (US-130).
    for (const booking of locked) {
      const attendance = requested.get(booking.id);
      if (attendance === undefined || attendance === booking.attendance) continue;
      await updateAttendance(trx, booking.id, attendance, user.id, now);
      await deps.events.publish(trx, {
        type: 'AttendanceRecorded',
        bookingId: booking.id,
        memberId: booking.member_id,
        classId,
        classStartAt: gymClass.start_at,
        previousAttendance: booking.attendance,
        attendance,
        recordedBy: user.id,
        recordedAt: now,
      });
    }

    return buildRoster(deps, trx, user, gymClass, now);
  });
}

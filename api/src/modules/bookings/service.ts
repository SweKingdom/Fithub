import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { WaitlistConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { Notifier } from '../../notifications/notifier.js';
import type { Clock } from '../../shared/clock.js';
import type { DomainEventBus } from '../../shared/domain-events.js';
import { DomainError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type { AuthUser } from '../auth/types.js';
import { notifyPromotions, promoteNext } from '../waitlist/promotion.js';
import { assertStaffOfClass, classNotFound, getOwnBookingForUpdate, getReadableBooking } from './access.js';
import { cancelDeadline, formatCutoff, isWithinCancelWindow } from './cancel-window.js';
import {
  findClassForRoster,
  countActiveBookings,
  listClassRoster,
  listMemberBookings,
  markCancelled,
  type BookingRow,
} from './repository.js';

const bookingStatus = z.enum(['confirmed', 'pending_payment', 'cancelled']);
const attendance = z.enum(['unknown', 'attended', 'no_show']);

export const bookingDtoSchema = z.object({
  id: z.string().uuid(),
  classId: z.string().uuid(),
  className: z.string(),
  clubName: z.string(),
  clubTimezone: z.string(),
  startAt: z.string(),
  durationMinutes: z.number().int(),
  status: bookingStatus,
  attendance,
  /** Last moment the booking can be cancelled: `startAt` minus the configured cut-off. */
  cancelDeadline: z.string(),
  /** When the booking was cancelled; null while it is active. */
  cancelledAt: z.string().nullable(),
  canCancel: z.boolean(),
  /** Only when the viewer is staff. */
  memberName: z.string().optional(),
});

export const myBookingsQuerySchema = z.object({
  period: z.enum(['upcoming', 'past']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const myBookingsResponseSchema = z.object({
  items: z.array(bookingDtoSchema),
  total: z.number().int(),
});

export const rosterResponseSchema = z.object({
  classId: z.string().uuid(),
  capacity: z.number().int(),
  freePlaces: z.number().int().min(0),
  items: z.array(
    z.object({
      bookingId: z.string().uuid(),
      memberId: z.string().uuid(),
      memberName: z.string(),
      status: bookingStatus,
      attendance,
      bookedAt: z.string(),
    }),
  ),
});

export type BookingDto = z.infer<typeof bookingDtoSchema>;
export type MyBookingsQuery = z.infer<typeof myBookingsQuerySchema>;

export interface BookingDeps {
  db: Kysely<Database>;
  clock: Clock;
  waitlist: WaitlistConfig;
  /** Members can cancel until this many minutes before the class starts (`BOOKING_CANCEL_CUTOFF_MINUTES`). */
  cancelCutoffMinutes: number;
  events: DomainEventBus;
  notifier: Notifier;
  logger: Logger;
}

const isActive = (status: BookingRow['status']): boolean => status === 'confirmed' || status === 'pending_payment';

/**
 * The one place that decides `canCancel`: the viewer is the member who owns the booking, the booking is active and
 * `now` is within the cancellation window (at or before `start_at − cutoff`).
 */
export function toBookingDto(row: BookingRow, viewer: AuthUser, now: Date, cutoffMinutes: number): BookingDto {
  const isStaff = viewer.role !== 'member';
  return {
    id: row.id,
    classId: row.class_id,
    className: row.class_name,
    clubName: row.club_name,
    clubTimezone: row.club_timezone,
    startAt: row.start_at.toISOString(),
    durationMinutes: row.duration_minutes,
    status: row.status,
    attendance: row.attendance,
    cancelDeadline: cancelDeadline(row.start_at, cutoffMinutes).toISOString(),
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    canCancel:
      !isStaff &&
      row.member_id === viewer.id &&
      isActive(row.status) &&
      isWithinCancelWindow(now, row.start_at, cutoffMinutes),
    ...(isStaff ? { memberName: row.member_name } : {}),
  };
}

/** The signed-in member's own bookings. The member id comes from the session only. */
export async function listMyBookings(deps: BookingDeps, user: AuthUser, query: MyBookingsQuery) {
  const now = deps.clock.now();
  const { rows, total } = await listMemberBookings(deps.db, user.id, query.period, now, query.limit, query.offset);
  return { items: rows.map((row) => toBookingDto(row, user, now, deps.cancelCutoffMinutes)), total };
}

export async function getBooking(deps: BookingDeps, user: AuthUser, id: string): Promise<BookingDto> {
  return toBookingDto(
    await getReadableBooking(deps.db, user, id),
    user,
    deps.clock.now(),
    deps.cancelCutoffMinutes,
  );
}

/** Roster of a class in the staff member's own club: active bookings, member names only. */
export async function getClassRoster(deps: BookingDeps, user: AuthUser, classId: string) {
  const gymClass = await findClassForRoster(deps.db, classId);
  if (!gymClass) throw classNotFound();
  assertStaffOfClass(user, gymClass);
  const [rows, active] = await Promise.all([
    listClassRoster(deps.db, classId),
    countActiveBookings(deps.db, classId),
  ]);
  return {
    classId,
    capacity: gymClass.capacity,
    freePlaces: Math.max(gymClass.capacity - active, 0),
    items: rows.map((row) => ({
      bookingId: row.booking_id,
      memberId: row.member_id,
      memberName: row.member_name,
      status: row.status,
      attendance: row.attendance,
      bookedAt: row.booked_at.toISOString(),
    })),
  };
}

/**
 * The member cancels their own booking up to the cut-off before the class starts (US-124). One transaction, class
 * lock before booking lock (ADR-010): it marks the booking cancelled, raises `BookingCancelled` (a failing
 * subscriber rolls everything back) and offers the freed place to the waiting list. Someone else's or an unknown
 * booking is `404 BOOKING_NOT_FOUND`; the row is never touched.
 */
export async function cancelBooking(deps: BookingDeps, user: AuthUser, id: string): Promise<BookingDto> {
  const now = deps.clock.now();
  const promotions = await deps.db.transaction().execute(async (trx) => {
    const { booking, gymClass } = await getOwnBookingForUpdate(trx, user, id);
    if (booking.status === 'cancelled') {
      throw new DomainError('BOOKING_ALREADY_CANCELLED', 'This booking is already cancelled.', 409);
    }
    if (gymClass.status === 'cancelled') {
      throw new DomainError('CLASS_CANCELLED', 'This class has been cancelled.', 409);
    }
    if (!isWithinCancelWindow(now, gymClass.start_at, deps.cancelCutoffMinutes)) {
      throw new DomainError(
        'CANCELLATION_WINDOW_CLOSED',
        `Bookings can only be cancelled up to ${formatCutoff(deps.cancelCutoffMinutes)} before the class starts.`,
        409,
      );
    }
    await markCancelled(trx, booking.id, now);
    await deps.events.publish(trx, {
      type: 'BookingCancelled',
      bookingId: booking.id,
      classId: booking.class_id,
      memberId: user.id,
      previousStatus: booking.status,
      cancelledAt: now,
      cause: 'member_cancelled',
    });
    return promoteNext(trx, booking.class_id, { clock: deps.clock, config: deps.waitlist, logger: deps.logger });
  });
  await notifyPromotions(promotions, deps.notifier, deps.logger);
  return getBooking(deps, user, id);
}

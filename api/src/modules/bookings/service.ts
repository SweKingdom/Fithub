import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { WaitlistConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { Notifier } from '../../notifications/notifier.js';
import type { Clock } from '../../shared/clock.js';
import { DomainError } from '../../shared/errors.js';
import type { Logger } from '../../shared/logger.js';
import type { AuthUser } from '../auth/types.js';
import { PAYMENT_STATUSES } from '../payments/tables.js';
import { notifyPromotions, promoteNext } from '../waitlist/promotion.js';
import { assertStaffOfClass, classNotFound, getOwnBookingForUpdate, getReadableBooking } from './access.js';
import {
  findClassForRoster,
  countActiveBookings,
  listClassRoster,
  listMemberBookings,
  markBookingCancelled,
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
  /** `null` for a booking without a payment row (regular members). */
  paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
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
  /** `config.payments.enabled`: while false, a freed place is not offered to drop-in members (US-132). */
  paymentsEnabled: boolean;
  notifier: Notifier;
  logger: Logger;
}

const isActive = (status: BookingRow['status']): boolean => status === 'confirmed' || status === 'pending_payment';

/**
 * The one place that decides `canCancel`: the viewer is the member who owns the booking, the booking is active and
 * the class has not started. US-124 swaps in its cut-off rule here.
 */
export function toBookingDto(row: BookingRow, viewer: AuthUser, now: Date): BookingDto {
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
    paymentStatus: row.payment_status,
    canCancel: !isStaff && row.member_id === viewer.id && isActive(row.status) && row.start_at > now,
    ...(isStaff ? { memberName: row.member_name } : {}),
  };
}

/** The signed-in member's own bookings. The member id comes from the session only. */
export async function listMyBookings(deps: BookingDeps, user: AuthUser, query: MyBookingsQuery) {
  const now = deps.clock.now();
  const { rows, total } = await listMemberBookings(deps.db, user.id, query.period, now, query.limit, query.offset);
  return { items: rows.map((row) => toBookingDto(row, user, now)), total };
}

export async function getBooking(deps: BookingDeps, user: AuthUser, id: string): Promise<BookingDto> {
  return toBookingDto(await getReadableBooking(deps.db, user, id), user, deps.clock.now());
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
 * Placeholder that US-124 replaces (cut-off, credits, events). Cancels the member's own active booking on a class
 * that has not started, then offers the freed place to the waiting list. Someone else's or an unknown booking is
 * `404 BOOKING_NOT_FOUND`; the row is never touched.
 */
export async function cancelBooking(deps: BookingDeps, user: AuthUser, id: string): Promise<BookingDto> {
  const now = deps.clock.now();
  const promotions = await deps.db.transaction().execute(async (trx) => {
    const { booking, gymClass } = await getOwnBookingForUpdate(trx, user, id);
    if (!isActive(booking.status) || gymClass.start_at <= now) {
      throw new DomainError('BOOKING_NOT_CANCELLABLE', 'This booking can no longer be cancelled.', 409);
    }
    await markBookingCancelled(trx, booking.id, now);
    return promoteNext(trx, booking.class_id, {
      clock: deps.clock,
      config: deps.waitlist,
      logger: deps.logger,
      paymentsEnabled: deps.paymentsEnabled,
    });
  });
  await notifyPromotions(promotions, deps.notifier, deps.logger);
  return getBooking(deps, user, id);
}

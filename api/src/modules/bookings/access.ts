import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { DomainError, forbidden } from '../../shared/errors.js';
import type { AuthUser } from '../auth/types.js';
import {
  findBookingForClub,
  findBookingForMember,
  findOwnBooking,
  lockClassForUpdate,
  type BookingRow,
  type LockedClass,
} from './repository.js';

/** The same answer for "does not exist" and "is not yours": the booking's existence is never revealed. */
export function bookingNotFound(): DomainError {
  return new DomainError('BOOKING_NOT_FOUND', 'This booking does not exist.', 404);
}

export function classNotFound(): DomainError {
  return new DomainError('CLASS_NOT_FOUND', 'This class does not exist.', 404);
}

/**
 * Read access to one booking: a member sees their own; staff see bookings of classes in their club.
 * The owner or club is part of the SQL `WHERE`, never filtered after the fetch.
 */
export async function getReadableBooking(db: Kysely<Database>, user: AuthUser, id: string): Promise<BookingRow> {
  let booking: BookingRow | undefined;
  if (user.role === 'member') {
    booking = await findBookingForMember(db, id, user.id);
  } else if (user.clubId !== null) {
    booking = await findBookingForClub(db, id, user.clubId);
  }
  if (!booking) throw bookingNotFound();
  return booking;
}

/**
 * Write access to one booking, inside the caller's transaction: members only, own bookings only.
 * Takes the `gym_class` lock before the booking lock (ADR-010) and returns both locked rows.
 */
export async function getOwnBookingForUpdate(
  trx: Kysely<Database>,
  user: AuthUser,
  id: string,
): Promise<{ booking: { id: string; class_id: string; status: BookingRow['status'] }; gymClass: LockedClass }> {
  if (user.role !== 'member') throw bookingNotFound();
  const found = await findOwnBooking(trx, id, user.id, false);
  if (!found) throw bookingNotFound();
  const gymClass = await lockClassForUpdate(trx, found.class_id);
  const booking = await findOwnBooking(trx, id, user.id, true);
  if (!gymClass || !booking) throw bookingNotFound();
  return { booking, gymClass };
}

/** Staff may manage a class only in their own club. */
export function assertStaffOfClass(user: AuthUser, gymClass: { club_id: string }): void {
  const isStaff = user.role === 'instructor' || user.role === 'club_manager';
  if (!isStaff || user.clubId !== gymClass.club_id) {
    throw forbidden('You can only manage classes for your own club.');
  }
}

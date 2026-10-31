import type { Kysely } from 'kysely';
import type { Clock } from '../../shared/clock.js';
import type { AuthUser } from '../auth/types.js';
import type { BookingDatabase } from './db-types.js';
import { DEFAULT_CANCEL_CUTOFF_MINUTES, toBookingDto, type BookingDto } from './dto.js';
import { alreadyBooked, classFull, classNotBookable, classNotFound } from './errors.js';
import {
  countActiveBookings,
  findActiveBooking,
  findBookingRowById,
  insertBooking,
  lockClassForUpdate,
} from './repository.js';

export interface BookingDeps {
  db: Kysely<BookingDatabase>;
  clock: Clock;
}

export interface BookResult {
  booking: BookingDto;
  /** 201 for a confirmed booking, 202 for a drop-in place held until payment (US-132). */
  httpStatus: 201 | 202;
}

const ACTIVE_BOOKING_INDEX = 'booking_active_member_class_uq';

/** PostgreSQL unique violation on the partial index that forbids two active bookings of one class by one member. */
function isActiveBookingConflict(error: unknown): boolean {
  const pgError = error as { code?: unknown; constraint?: unknown } | null;
  return pgError?.code === '23505' && pgError.constraint === ACTIVE_BOOKING_INDEX;
}

/**
 * Books a place for the signed-in member. The class row is locked first, so concurrent requests
 * for the same class are serialised and the capacity can never be exceeded. The member is always
 * `user`, never taken from the request.
 */
export async function bookClass(deps: BookingDeps, user: AuthUser, classId: string): Promise<BookResult> {
  try {
    return await deps.db.transaction().execute(async (trx) => {
      const gymClass = await lockClassForUpdate(trx, classId);
      if (!gymClass) throw classNotFound();

      const now = deps.clock.now();
      if (gymClass.status !== 'scheduled' || gymClass.start_at.getTime() <= now.getTime()) {
        throw classNotBookable();
      }
      // US-130 adds the no-show block check here; US-125 adds the credit check after the capacity check.
      if (await findActiveBooking(trx, classId, user.id)) throw alreadyBooked();
      if ((await countActiveBookings(trx, classId)) >= gymClass.capacity) throw classFull();

      const dropIn = user.memberType === 'drop_in';
      const id = await insertBooking(trx, {
        class_id: classId,
        member_id: user.id,
        status: dropIn ? 'pending_payment' : 'confirmed',
        source: 'direct',
        booked_at: now,
      });
      const row = await findBookingRowById(trx, id);
      if (!row) throw new Error(`Booking ${id} was not found after it was inserted.`);

      return {
        booking: toBookingDto(row, now, DEFAULT_CANCEL_CUTOFF_MINUTES, user),
        httpStatus: dropIn ? 202 : 201,
      };
    });
  } catch (error) {
    // Defence in depth: the row lock already prevents this, the unique index guarantees it.
    if (isActiveBookingConflict(error)) throw alreadyBooked();
    throw error;
  }
}

import type { Kysely } from 'kysely';
import type { CreditDatabase } from './db-types.js';

/**
 * Local copies of the US-124 event types. At merge, import `BookingCancelled` and the bus type from the
 * bookings/events module and delete this file.
 */
export interface BookingCancelled {
  type: 'BookingCancelled';
  bookingId: string;
  memberId: string;
  cancelledAt: Date;
  cause: 'member_cancelled' | 'class_cancelled';
}

/** The part of the in-transaction domain event bus (ADR-009) that the credits module needs. */
export interface CreditEventBus {
  subscribe(
    type: 'BookingCancelled',
    handler: (event: BookingCancelled, trx: Kysely<CreditDatabase>) => Promise<void>,
  ): void;
}

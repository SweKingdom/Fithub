import type { Kysely } from 'kysely';
import type { CreditDatabase } from './db-types.js';
import { noCredits } from './errors.js';
import type { BookingCancelled } from './events.js';
import { refundReasonFor } from './policy.js';
import {
  creditOne,
  debitOne,
  findBookingTransactions,
  getBalance,
  insertTransaction,
  lockBalance,
} from './repository.js';

type Db = Kysely<CreditDatabase>;

export interface CreditLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

/**
 * Takes 1 credit for a booking and writes the ledger row. Throws `NO_CREDITS` when the member has none;
 * the surrounding transaction then rolls back, including the booking insert.
 */
export async function consumeCreditForBooking(
  trx: Db,
  input: { memberId: string; bookingId: string; now: Date },
): Promise<void> {
  const balanceAfter = await debitOne(trx, input.memberId, input.now);
  if (balanceAfter === null) throw noCredits();
  await insertTransaction(trx, {
    member_id: input.memberId,
    delta: -1,
    reason: 'booking',
    booking_id: input.bookingId,
    balance_after: balanceAfter,
    created_at: input.now,
  });
}

/** Promotion eligibility. Holds the balance row lock until commit, so the debit that follows cannot fail. */
export async function hasCreditForUpdate(trx: Db, memberId: string): Promise<boolean> {
  return (await lockBalance(trx, memberId)) >= 1;
}

/** Waiting-list join: the member needs at least 1 credit. Nothing is reserved. */
export async function assertHasCredit(trx: Db, memberId: string): Promise<void> {
  if ((await getBalance(trx, memberId)) < 1) throw noCredits();
}

/**
 * Returns the credit of a cancelled booking (`BookingCancelled` handler). Does nothing when the booking
 * never used a credit (drop-in, or made before US-125) or when the credit was already returned.
 */
export async function returnCreditForCancelledBooking(
  trx: Db,
  event: BookingCancelled,
  deps: { logger: CreditLogger },
): Promise<void> {
  const reason = refundReasonFor(event.cause);
  if (reason === null) return;

  const { debit, refund } = await findBookingTransactions(trx, event.bookingId);
  if (debit === null || refund !== null) return;

  const balanceAfter = await creditOne(trx, event.memberId, event.cancelledAt);
  await insertTransaction(trx, {
    member_id: event.memberId,
    delta: 1,
    reason,
    booking_id: event.bookingId,
    balance_after: balanceAfter,
    created_at: event.cancelledAt,
  });
  deps.logger.info({ bookingId: event.bookingId, memberId: event.memberId, reason }, 'credits.returned');
}

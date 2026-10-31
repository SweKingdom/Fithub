import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditDatabase } from '../../../src/modules/credits/db-types.js';
import type { BookingCancelled } from '../../../src/modules/credits/events.js';
import { registerCreditHandlers } from '../../../src/modules/credits/handlers.js';
import * as repository from '../../../src/modules/credits/repository.js';
import {
  assertHasCredit,
  consumeCreditForBooking,
  hasCreditForUpdate,
  returnCreditForCancelledBooking,
} from '../../../src/modules/credits/service.js';

vi.mock('../../../src/modules/credits/repository.js', () => ({
  getBalance: vi.fn(),
  lockBalance: vi.fn(),
  debitOne: vi.fn(),
  creditOne: vi.fn(),
  insertTransaction: vi.fn(),
  findBookingTransactions: vi.fn(),
}));

const repo = vi.mocked(repository);
const trx = {} as Kysely<CreditDatabase>;
const NOW = new Date('2026-10-30T09:00:00.000Z');
const CANCELLED_AT = new Date('2026-10-30T10:00:00.000Z');
const logger = { info: vi.fn() };

const event = (cause: BookingCancelled['cause'] = 'member_cancelled'): BookingCancelled => ({
  type: 'BookingCancelled',
  bookingId: 'booking-1',
  memberId: 'member-1',
  cancelledAt: CANCELLED_AT,
  cause,
});

const ledgerRow = (reason: 'booking' | 'cancellation_refund') => ({
  id: 'tx-1',
  member_id: 'member-1',
  delta: reason === 'booking' ? -1 : 1,
  reason,
  booking_id: 'booking-1',
  balance_after: 0,
  created_at: NOW,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('consumeCreditForBooking (US-125 AC 1, AC 2)', () => {
  it('AC 1: takes one credit and writes the booking ledger row', async () => {
    repo.debitOne.mockResolvedValue(4);
    await consumeCreditForBooking(trx, { memberId: 'member-1', bookingId: 'booking-1', now: NOW });
    expect(repo.debitOne).toHaveBeenCalledWith(trx, 'member-1', NOW);
    expect(repo.insertTransaction).toHaveBeenCalledWith(trx, {
      member_id: 'member-1',
      delta: -1,
      reason: 'booking',
      booking_id: 'booking-1',
      balance_after: 4,
      created_at: NOW,
    });
  });

  it('AC 2: throws NO_CREDITS and writes no ledger row when the debit finds no credit', async () => {
    repo.debitOne.mockResolvedValue(null);
    await expect(
      consumeCreditForBooking(trx, { memberId: 'member-1', bookingId: 'booking-1', now: NOW }),
    ).rejects.toThrow('You have no class credits left.');
    expect(repo.insertTransaction).not.toHaveBeenCalled();
  });
});

describe('credit checks for the waiting list (US-125 AC 8, AC 9)', () => {
  it('hasCreditForUpdate is true with at least 1 credit and false with 0', async () => {
    repo.lockBalance.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await hasCreditForUpdate(trx, 'member-1')).toBe(true);
    expect(await hasCreditForUpdate(trx, 'member-1')).toBe(false);
  });

  it('assertHasCredit passes with 1 credit and throws NO_CREDITS with 0', async () => {
    repo.getBalance.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(assertHasCredit(trx, 'member-1')).resolves.toBeUndefined();
    await expect(assertHasCredit(trx, 'member-1')).rejects.toThrow('You have no class credits left.');
  });
});

describe('returnCreditForCancelledBooking (US-125 AC 5–7)', () => {
  it('AC 5: returns one credit with reason cancellation_refund at the cancellation time', async () => {
    repo.findBookingTransactions.mockResolvedValue({ debit: ledgerRow('booking'), refund: null });
    repo.creditOne.mockResolvedValue(1);
    await returnCreditForCancelledBooking(trx, event('member_cancelled'), { logger });
    expect(repo.creditOne).toHaveBeenCalledWith(trx, 'member-1', CANCELLED_AT);
    expect(repo.insertTransaction).toHaveBeenCalledWith(trx, {
      member_id: 'member-1',
      delta: 1,
      reason: 'cancellation_refund',
      booking_id: 'booking-1',
      balance_after: 1,
      created_at: CANCELLED_AT,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { bookingId: 'booking-1', memberId: 'member-1', reason: 'cancellation_refund' },
      'credits.returned',
    );
  });

  it('AC 6: uses reason class_cancelled_refund when the club cancels the class', async () => {
    repo.findBookingTransactions.mockResolvedValue({ debit: ledgerRow('booking'), refund: null });
    repo.creditOne.mockResolvedValue(3);
    await returnCreditForCancelledBooking(trx, event('class_cancelled'), { logger });
    expect(repo.insertTransaction).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({ reason: 'class_cancelled_refund', balance_after: 3 }),
    );
  });

  it('AC 7: returns nothing for a booking without a debit (drop-in or made before US-125)', async () => {
    repo.findBookingTransactions.mockResolvedValue({ debit: null, refund: null });
    await returnCreditForCancelledBooking(trx, event(), { logger });
    expect(repo.creditOne).not.toHaveBeenCalled();
    expect(repo.insertTransaction).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('AC 7: returns nothing when the credit was already returned (handler runs twice)', async () => {
    repo.findBookingTransactions.mockResolvedValue({
      debit: ledgerRow('booking'),
      refund: ledgerRow('cancellation_refund'),
    });
    await returnCreditForCancelledBooking(trx, event(), { logger });
    expect(repo.creditOne).not.toHaveBeenCalled();
    expect(repo.insertTransaction).not.toHaveBeenCalled();
  });

  it('AC 7: lets a failure propagate so the cancel transaction rolls back', async () => {
    repo.findBookingTransactions.mockResolvedValue({ debit: ledgerRow('booking'), refund: null });
    repo.creditOne.mockRejectedValue(new Error('db down'));
    await expect(returnCreditForCancelledBooking(trx, event(), { logger })).rejects.toThrow('db down');
  });
});

describe('registerCreditHandlers', () => {
  it('subscribes the credit return to BookingCancelled', async () => {
    const subscribe = vi.fn();
    registerCreditHandlers({ subscribe }, { logger });
    expect(subscribe).toHaveBeenCalledWith('BookingCancelled', expect.any(Function));

    repo.findBookingTransactions.mockResolvedValue({ debit: ledgerRow('booking'), refund: null });
    repo.creditOne.mockResolvedValue(1);
    await subscribe.mock.calls[0][1](event(), trx);
    expect(repo.insertTransaction).toHaveBeenCalledOnce();
  });
});
